package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Reader: pandoc Markdown with every raw-passthrough extension disabled. Text containing
// backslashes is escaped, not interpreted; only math reaches LaTeX verbatim (and is checked).
const mdReader = "markdown-raw_tex-raw_html-raw_attribute-implicit_figures-tex_math_single_backslash-latex_macros+tex_math_dollars"

type renderMeta struct {
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	University  string `json:"university"`
	StudentName string `json:"student_name"`
	RollNumber  string `json:"roll_number"`
	Course      string `json:"course"`
	Instructor  string `json:"instructor"`
	Due         string `json:"due"`
	Date        string `json:"date"`
	Disclosure  string `json:"disclosure"`
}

type renderRequest struct {
	Markdown string     `json:"markdown"`
	Meta     renderMeta `json:"meta"`
	Formats  []string   `json:"formats"`
}

type renderResponse struct {
	PDF  []byte `json:"pdf,omitempty"`  // base64 in JSON
	DOCX []byte `json:"docx,omitempty"` // base64 in JSON
}

type renderError struct {
	Code   string `json:"error"`
	Detail string `json:"detail,omitempty"`
}

func (e *renderError) Error() string { return e.Code + ": " + e.Detail }

const (
	maxMarkdown = 400 << 10
	maxOutput   = 25 << 20
)

func (s *server) render(ctx context.Context, req renderRequest) (*renderResponse, error) {
	if len(req.Markdown) == 0 || len(req.Markdown) > maxMarkdown {
		return nil, &renderError{Code: "invalid_markdown", Detail: "empty or too large"}
	}
	wantPDF, wantDOCX := false, false
	for _, f := range req.Formats {
		switch f {
		case "pdf":
			wantPDF = true
		case "docx":
			wantDOCX = true
		default:
			return nil, &renderError{Code: "invalid_format"}
		}
	}
	if !wantPDF && !wantDOCX {
		return nil, &renderError{Code: "invalid_format"}
	}

	dir, err := os.MkdirTemp(s.workDir, "job-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)

	if err := os.WriteFile(filepath.Join(dir, "input.md"), []byte(req.Markdown), 0o600); err != nil {
		return nil, err
	}

	// 1. Markdown -> pandoc AST (JSON), in a sandboxed pandoc that cannot touch other files.
	astJSON, err := s.run(ctx, dir, 30*time.Second, nil, "pandoc", "--sandbox", "-f", mdReader, "-t", "json", "input.md")
	if err != nil {
		return nil, &renderError{Code: "parse_failed", Detail: tail(err.Error(), 300)}
	}
	var ast map[string]any
	if err := json.Unmarshal(astJSON, &ast); err != nil {
		return nil, &renderError{Code: "parse_failed"}
	}

	// 2. Inspect: no raw passthrough, no dangerous math, no images.
	if _, err := inspectAST(ast); err != nil {
		return nil, &renderError{Code: "unsafe_content", Detail: err.Error()}
	}

	// 3. Student details go into the AST as literal strings (never parsed as markup).
	meta := map[string]any{}
	add := func(key, val string, max int) {
		if v := cleanMetaValue(val, max); v != "" {
			meta[key] = metaInlines(v)
		}
	}
	add("title", firstNonEmpty(req.Meta.Title, "Worked solution"), 200)
	add("subtitle", req.Meta.Subtitle, 200)
	add("university", req.Meta.University, 160)
	add("student-name", req.Meta.StudentName, 120)
	add("roll-number", req.Meta.RollNumber, 64)
	add("course", req.Meta.Course, 160)
	add("instructor", req.Meta.Instructor, 120)
	add("due", req.Meta.Due, 80)
	add("date", req.Meta.Date, 80)
	add("disclosure", req.Meta.Disclosure, 600)
	ast["meta"] = meta

	out := &renderResponse{}
	if wantPDF {
		pdf, err := s.renderPDF(ctx, dir, ast)
		if err != nil {
			return nil, err
		}
		out.PDF = pdf
	}
	if wantDOCX {
		docx, err := s.renderDOCX(ctx, dir, ast, req.Meta)
		if err != nil {
			return nil, err
		}
		out.DOCX = docx
	}
	return out, nil
}

func (s *server) renderPDF(ctx context.Context, dir string, ast map[string]any) ([]byte, error) {
	if err := os.WriteFile(filepath.Join(dir, "doc.json"), mustJSON(ast), 0o600); err != nil {
		return nil, err
	}
	if _, err := s.run(ctx, dir, 30*time.Second, nil, "pandoc", "--sandbox", "-f", "json", "-t", "latex",
		"--template", s.templatePath, "-o", "doc.tex", "doc.json"); err != nil {
		return nil, &renderError{Code: "latex_generation_failed", Detail: tail(err.Error(), 300)}
	}
	texEnv := []string{
		"openin_any=p",   // no reading outside the job directory
		"openout_any=p",  // no writing outside the job directory
		"shell_escape=f", // never run external programs
		"TEXMFVAR=" + filepath.Join(dir, ".texmf-var"),
		"TEXMFCONFIG=" + filepath.Join(dir, ".texmf-config"),
		"HOME=" + dir,
		"max_print_line=1000",
	}
	// Two passes so "Page X of Y" resolves.
	for pass := 0; pass < 2; pass++ {
		if _, err := s.run(ctx, dir, 60*time.Second, texEnv, "xelatex", "-no-shell-escape",
			"-interaction=nonstopmode", "-halt-on-error", "-file-line-error", "doc.tex"); err != nil {
			return nil, &renderError{Code: "latex_failed", Detail: latexError(dir)}
		}
	}
	pdf, err := os.ReadFile(filepath.Join(dir, "doc.pdf"))
	if err != nil {
		return nil, &renderError{Code: "latex_failed", Detail: "no pdf produced"}
	}
	if len(pdf) > maxOutput {
		return nil, &renderError{Code: "output_too_large"}
	}
	return pdf, nil
}

func (s *server) renderDOCX(ctx context.Context, dir string, ast map[string]any, m renderMeta) ([]byte, error) {
	// DOCX has no LaTeX template, so prepend the student details as plain paragraphs.
	var header []any
	line := func(label, val string) {
		if v := cleanMetaValue(val, 160); v != "" {
			header = append(header, map[string]any{"t": "Para", "c": append(
				[]any{map[string]any{"t": "Strong", "c": inlines(label)}, map[string]any{"t": "Space"}}, inlines(v)...)})
		}
	}
	line("University:", m.University)
	line("Name:", m.StudentName)
	line("Roll No.:", m.RollNumber)
	line("Course:", m.Course)
	line("Instructor:", m.Instructor)
	line("Due:", m.Due)
	blocks, _ := ast["blocks"].([]any)
	docAST := map[string]any{"pandoc-api-version": ast["pandoc-api-version"], "meta": ast["meta"], "blocks": blocks}
	if len(header) > 0 {
		docAST["blocks"] = append(append(header, map[string]any{"t": "HorizontalRule"}), blocks...)
	}
	if v := cleanMetaValue(m.Disclosure, 600); v != "" {
		docAST["blocks"] = append(docAST["blocks"].([]any),
			map[string]any{"t": "HorizontalRule"},
			map[string]any{"t": "Para", "c": []any{map[string]any{"t": "Emph", "c": inlines(v)}}})
	}
	if err := os.WriteFile(filepath.Join(dir, "docx.json"), mustJSON(docAST), 0o600); err != nil {
		return nil, err
	}
	if _, err := s.run(ctx, dir, 30*time.Second, nil, "pandoc", "--sandbox", "-f", "json", "-t", "docx",
		"-o", "doc.docx", "docx.json"); err != nil {
		return nil, &renderError{Code: "docx_failed", Detail: tail(err.Error(), 300)}
	}
	docx, err := os.ReadFile(filepath.Join(dir, "doc.docx"))
	if err != nil {
		return nil, &renderError{Code: "docx_failed"}
	}
	if len(docx) > maxOutput {
		return nil, &renderError{Code: "output_too_large"}
	}
	return docx, nil
}

// run executes a tool with a timeout, a minimal environment and its own process group
// (so a runaway TeX run is killed together with any children).
func (s *server) run(ctx context.Context, dir string, timeout time.Duration, extraEnv []string, name string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Env = append([]string{"PATH=" + os.Getenv("PATH"), "LANG=C.UTF-8", "HOME=" + dir}, extraEnv...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &limitedWriter{buf: &stdout, max: 64 << 20}
	cmd.Stderr = &limitedWriter{buf: &stderr, max: 64 << 10}
	if err := cmd.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, fmt.Errorf("%s timed out", name)
		}
		return nil, fmt.Errorf("%s: %v: %s", name, err, stderr.String())
	}
	return stdout.Bytes(), nil
}

// latexError extracts the first error line from the TeX log for the repair loop.
func latexError(dir string) string {
	log, err := os.ReadFile(filepath.Join(dir, "doc.log"))
	if err != nil {
		return "unknown latex error"
	}
	lines := strings.Split(string(log), "\n")
	for i, l := range lines {
		if strings.HasPrefix(l, "!") || strings.Contains(l, ".tex:") && strings.Contains(l, "error") || strings.HasPrefix(l, "./doc.tex:") {
			end := i + 3
			if end > len(lines) {
				end = len(lines)
			}
			return tail(strings.Join(lines[i:end], " | "), 400)
		}
	}
	return "latex failed"
}

type limitedWriter struct {
	buf *bytes.Buffer
	max int
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	if w.buf.Len()+len(p) > w.max {
		return 0, errors.New("output limit exceeded")
	}
	return w.buf.Write(p)
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
