package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestCheckMathAllowsNormalMath(t *testing.T) {
	ok := []string{
		`\frac{a}{b} + \sqrt{x^2 + 1}`,
		`\int_0^1 x\,dx = \tfrac{1}{2}`,
		`\begin{aligned} a &= b \\ c &= d \end{aligned}`,
		`\begin{pmatrix} 1 & 0 \\ 0 & 1 \end{pmatrix}`,
		`\mathbb{R}^n,\ \boldsymbol{v},\ \text{for all } x`,
		`f(x) = \begin{cases} 1 & x>0 \\ 0 & \text{otherwise} \end{cases}`,
		`\operatorname{argmax}_x \sum_{i=1}^{n} x_i`,
		`\left( \frac{\partial L}{\partial w} \right)`,
	}
	for _, m := range ok {
		if err := checkMath(m); err != nil {
			t.Errorf("rejected valid math %q: %v", m, err)
		}
	}
}

func TestCheckMathRejectsDangerous(t *testing.T) {
	bad := []string{
		`\input{/etc/passwd}`,
		`x + \include{secrets}`,
		`\immediate\write18{rm -rf /}`,
		`\openin5=/etc/hostname`,
		`\def\x{1}`,
		`\newcommand{\evil}{x}`,
		`\catcode`,
		`\csname input\endcsname{/etc/passwd}`,
		`^^5cinput{/etc/passwd}`,
		`\begin{filecontents}{x}\end{filecontents}`,
		`\begin{verbatim}x\end{verbatim}`,
		`\text{\input{x}}`,
		`\usepackage{shellesc}`,
		`\directlua{os.execute("id")}`,
		`\href{file:///etc/passwd}{x}`,
		`{{{`,
		strings.Repeat("x", maxMathLen+1),
	}
	for _, m := range bad {
		if err := checkMath(m); err == nil {
			t.Errorf("accepted dangerous math %q", m)
		}
	}
}

func TestInspectASTRejectsRawAndStripsImages(t *testing.T) {
	ast := map[string]any{"blocks": []any{
		map[string]any{"t": "Para", "c": []any{
			map[string]any{"t": "Image", "c": []any{}},
			map[string]any{"t": "Math", "c": []any{map[string]any{"t": "InlineMath"}, `x^2`}},
		}},
	}}
	out, err := inspectAST(ast)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(out)
	if strings.Contains(string(b), `"Image"`) {
		t.Fatal("images must be removed")
	}

	raw := map[string]any{"blocks": []any{map[string]any{"t": "RawBlock", "c": []any{"latex", `\input{x}`}}}}
	if _, err := inspectAST(raw); err == nil {
		t.Fatal("raw blocks must be rejected")
	}
	evil := map[string]any{"blocks": []any{map[string]any{"t": "Math", "c": []any{map[string]any{"t": "DisplayMath"}, `\input{/etc/passwd}`}}}}
	if _, err := inspectAST(evil); err == nil {
		t.Fatal("dangerous math must be rejected")
	}
}

func TestMetaIsLiteralText(t *testing.T) {
	m := metaInlines(cleanMetaValue("Ali \\input{/etc/passwd} $x$\n\t Khan", 200))
	b, _ := json.Marshal(m)
	// The value stays as Str tokens: pandoc will escape the backslash, never interpret it.
	if !strings.Contains(string(b), `"t":"Str"`) || strings.Contains(string(b), "RawInline") {
		t.Fatalf("unexpected meta encoding: %s", b)
	}
	if got := cleanMetaValue("a\x00b\x07c", 10); strings.ContainsAny(got, "\x00\x07") {
		t.Fatal("control characters must be removed")
	}
}

func TestSniffAndPPTX(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		"ppt/slides/slide2.xml": `<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>`,
		"ppt/slides/slide1.xml": `<p:sld><a:p><a:r><a:t>Big-O notation</a:t></a:r></a:p><a:p><a:r><a:t>O(n log n)</a:t></a:r></a:p></p:sld>`,
		"[Content_Types].xml":   `<Types/>`,
	} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	_ = zw.Close()

	if k := sniff(buf.Bytes()); k != "pptx" {
		t.Fatalf("sniff = %q, want pptx", k)
	}
	pages, err := extractPPTX(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 2 || pages[0].Page != 1 || !strings.Contains(pages[0].Text, "O(n log n)") {
		t.Fatalf("unexpected pages %+v", pages)
	}
	if sniff([]byte("%PDF-1.7 ...")) != "pdf" || sniff([]byte("MZ\x00\x00binary")) != "" {
		t.Fatal("sniff misclassified")
	}
}
