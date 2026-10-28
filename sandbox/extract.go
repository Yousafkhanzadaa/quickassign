package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type extractRequest struct {
	FileName string `json:"file_name"`
	Data     []byte `json:"data"` // base64 in JSON
}

type page struct {
	Page int    `json:"page"`
	Text string `json:"text"`
}

type extractResponse struct {
	Kind      string `json:"kind"`
	Pages     []page `json:"pages"`
	Truncated bool   `json:"truncated"`
}

const (
	maxInputFile   = 50 << 20
	maxPages       = 400
	maxTextTotal   = 3 << 20
	maxZipEntries  = 5000
	maxZipEntry    = 8 << 20
	maxZipTotal    = 120 << 20
)

var errUnsupported = errors.New("unsupported file type")

// sniff identifies a file by content, never by the name or declared type.
func sniff(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "pdf"
	case bytes.HasPrefix(data, []byte("PK\x03\x04")):
		zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			return ""
		}
		for _, f := range zr.File {
			switch {
			case f.Name == "word/document.xml":
				return "docx"
			case strings.HasPrefix(f.Name, "ppt/slides/slide"):
				return "pptx"
			}
		}
		return ""
	case utf8.Valid(data) && !bytes.ContainsRune(data, 0):
		return "text"
	}
	return ""
}

func (s *server) extract(ctx context.Context, req extractRequest) (*extractResponse, error) {
	if len(req.Data) == 0 || len(req.Data) > maxInputFile {
		return nil, &renderError{Code: "invalid_file", Detail: "empty or too large"}
	}
	kind := sniff(req.Data)
	var pages []page
	var err error
	switch kind {
	case "pdf":
		pages, err = s.extractPDF(ctx, req.Data)
	case "docx":
		pages, err = s.extractDOCX(ctx, req.Data)
	case "pptx":
		pages, err = extractPPTX(req.Data)
	case "text":
		pages = []page{{Page: 1, Text: string(req.Data)}}
	default:
		return nil, &renderError{Code: "unsupported_file"}
	}
	if err != nil {
		return nil, &renderError{Code: "extract_failed", Detail: tail(err.Error(), 200)}
	}
	resp := &extractResponse{Kind: kind}
	total := 0
	for _, p := range pages {
		if len(resp.Pages) >= maxPages || total+len(p.Text) > maxTextTotal {
			resp.Truncated = true
			break
		}
		p.Text = strings.ToValidUTF8(strings.TrimSpace(p.Text), "")
		total += len(p.Text)
		resp.Pages = append(resp.Pages, p)
	}
	return resp, nil
}

func (s *server) extractPDF(ctx context.Context, data []byte) ([]page, error) {
	dir, err := os.MkdirTemp(s.workDir, "ext-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	if err := os.WriteFile(filepath.Join(dir, "in.pdf"), data, 0o600); err != nil {
		return nil, err
	}
	out, err := s.run(ctx, dir, 60*time.Second, nil, "pdftotext", "-enc", "UTF-8", "-layout",
		"-l", strconv.Itoa(maxPages), "in.pdf", "-")
	if err != nil {
		return nil, err
	}
	var pages []page
	for i, txt := range strings.Split(string(out), "\f") {
		if strings.TrimSpace(txt) == "" {
			continue
		}
		pages = append(pages, page{Page: i + 1, Text: txt})
	}
	return pages, nil
}

func (s *server) extractDOCX(ctx context.Context, data []byte) ([]page, error) {
	if err := checkZip(data); err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp(s.workDir, "ext-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	if err := os.WriteFile(filepath.Join(dir, "in.docx"), data, 0o600); err != nil {
		return nil, err
	}
	out, err := s.run(ctx, dir, 60*time.Second, nil, "pandoc", "--sandbox", "-f", "docx", "-t", "plain", "--wrap=none", "in.docx")
	if err != nil {
		return nil, err
	}
	return []page{{Page: 1, Text: string(out)}}, nil
}

// checkZip rejects zip bombs before anything decompresses the archive.
func checkZip(data []byte) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	if len(zr.File) > maxZipEntries {
		return errors.New("too many archive entries")
	}
	var total uint64
	for _, f := range zr.File {
		if f.UncompressedSize64 > maxZipEntry*4 {
			return errors.New("archive entry too large")
		}
		total += f.UncompressedSize64
		if total > maxZipTotal {
			return errors.New("archive too large when decompressed")
		}
	}
	return nil
}

var slideName = regexp.MustCompile(`^ppt/slides/slide(\d+)\.xml$`)

func extractPPTX(data []byte) ([]page, error) {
	if err := checkZip(data); err != nil {
		return nil, err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	slides := map[int]*zip.File{}
	for _, f := range zr.File {
		if m := slideName.FindStringSubmatch(f.Name); m != nil {
			n, _ := strconv.Atoi(m[1])
			slides[n] = f
		}
	}
	nums := make([]int, 0, len(slides))
	for n := range slides {
		nums = append(nums, n)
	}
	sort.Ints(nums)
	var pages []page
	for _, n := range nums {
		text, err := slideText(slides[n])
		if err != nil {
			return nil, fmt.Errorf("slide %d: %w", n, err)
		}
		if strings.TrimSpace(text) != "" {
			pages = append(pages, page{Page: n, Text: text})
		}
	}
	return pages, nil
}

// slideText collects <a:t> runs, breaking lines at paragraph ends. encoding/xml never
// resolves external entities, so XXE is not possible here.
func slideText(f *zip.File) (string, error) {
	rc, err := f.Open()
	if err != nil {
		return "", err
	}
	defer rc.Close()
	dec := xml.NewDecoder(io.LimitReader(rc, maxZipEntry))
	dec.Strict = false
	var b strings.Builder
	inText := false
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return "", err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "t" {
				inText = true
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "t":
				inText = false
			case "p":
				b.WriteByte('\n')
			}
		case xml.CharData:
			if inText {
				b.Write(t)
			}
		}
	}
	return b.String(), nil
}
