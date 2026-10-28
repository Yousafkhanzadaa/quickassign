package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// TeX primitives and macros that can read/write files, run code, or redefine the
// language. Math is passed to LaTeX verbatim, so any of these inside a Math node is
// rejected outright (the worker validates math with KaTeX first; this is the backstop).
var dangerousTeX = regexp.MustCompile(`\\(` + strings.Join([]string{
	"input", "include", "includeonly", "openin", "openout", "closein", "closeout", "read", "readline",
	"write", "immediate", "catcode", "csname", "endcsname", "def", "edef", "gdef", "xdef", "let",
	"futurelet", "newcommand", "renewcommand", "providecommand", "DeclareRobustCommand",
	"DeclareMathOperator", "usepackage", "RequirePackage", "documentclass", "special", "directlua",
	"latelua", "luaexec", "jobname", "endinput", "loop", "expandafter", "noexpand", "everyjob",
	"everypar", "everymath", "everydisplay", "output", "shipout", "scantokens", "detokenize",
	"uppercase", "lowercase", "lstinputlisting", "verbatiminput", "VerbatimInput", "includegraphics",
	"import", "subimport", "subfile", "href", "url", "errmessage", "message", "typeout",
	"batchmode", "nonstopmode", "scrollmode", "errorstopmode", "afterassignment", "aftergroup",
	"uccode", "lccode", "mathcode", "delcode", "sfcode", "countdef", "dimendef", "skipdef",
	"toksdef", "chardef", "mathchardef", "setbox", "pdfprimitive", "primitive", "string",
	"meaning", "fontname", "begin", "end",
}, "|") + `)(?:[^A-Za-z]|$)`)

// \begin/\end are allowed only for these math environments.
var allowedEnvs = map[string]bool{
	"aligned": true, "alignedat": true, "array": true, "bmatrix": true, "Bmatrix": true,
	"cases": true, "dcases": true, "gathered": true, "matrix": true, "pmatrix": true,
	"smallmatrix": true, "split": true, "vmatrix": true, "Vmatrix": true, "rcases": true,
	"subarray": true,
}

var envPattern = regexp.MustCompile(`\\(begin|end)\s*\{([^}]*)\}`)

const maxMathLen = 4000

var errUnsafe = errors.New("unsafe content")

// checkMath returns an error if a math fragment could do anything other than typeset math.
func checkMath(tex string) error {
	if len(tex) > maxMathLen {
		return fmt.Errorf("%w: math fragment too long", errUnsafe)
	}
	// Strip allowed environments, then look for anything dangerous that remains.
	stripped := envPattern.ReplaceAllStringFunc(tex, func(m string) string {
		sub := envPattern.FindStringSubmatch(m)
		if allowedEnvs[strings.TrimSpace(sub[2])] {
			return ""
		}
		return m // left in place so dangerousTeX catches \begin{...} of other environments
	})
	if loc := dangerousTeX.FindStringIndex(stripped); loc != nil {
		return fmt.Errorf("%w: disallowed TeX command in math", errUnsafe)
	}
	if strings.Contains(tex, "^^") {
		return fmt.Errorf("%w: TeX character escape in math", errUnsafe) // ^^5c-style escapes
	}
	if strings.Count(tex, "{") != strings.Count(tex, "}") {
		return fmt.Errorf("%w: unbalanced braces in math", errUnsafe)
	}
	return nil
}

// inspectAST walks a pandoc JSON AST: it rejects raw passthrough and dangerous math, and
// removes images (solutions never embed external files).
func inspectAST(node any) (any, error) {
	switch v := node.(type) {
	case map[string]any:
		if t, ok := v["t"].(string); ok {
			switch t {
			case "RawInline", "RawBlock":
				return nil, fmt.Errorf("%w: raw %s passthrough", errUnsafe, t)
			case "Math":
				c, _ := v["c"].([]any)
				if len(c) != 2 {
					return nil, fmt.Errorf("%w: malformed math node", errUnsafe)
				}
				tex, _ := c[1].(string)
				if err := checkMath(tex); err != nil {
					return nil, err
				}
			case "Image":
				return map[string]any{"t": "Str", "c": "[image removed]"}, nil
			}
		}
		for k, child := range v {
			out, err := inspectAST(child)
			if err != nil {
				return nil, err
			}
			v[k] = out
		}
		return v, nil
	case []any:
		for i, child := range v {
			out, err := inspectAST(child)
			if err != nil {
				return nil, err
			}
			v[i] = out
		}
		return v, nil
	default:
		return v, nil
	}
}

// cleanMetaValue keeps metadata to printable text; it is inserted into the AST as
// literal strings, so pandoc escapes it for LaTeX and it is never parsed as markup.
func cleanMetaValue(s string, max int) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > max {
		s = string(r[:max])
	}
	return s
}

// metaInlines builds a pandoc MetaInlines value from plain text.
func metaInlines(s string) map[string]any {
	words := strings.Fields(s)
	inl := make([]any, 0, len(words)*2)
	for i, w := range words {
		if i > 0 {
			inl = append(inl, map[string]any{"t": "Space"})
		}
		inl = append(inl, map[string]any{"t": "Str", "c": w})
	}
	return map[string]any{"t": "MetaInlines", "c": inl}
}

// inlines builds plain inline content for blocks we prepend (DOCX header).
func inlines(s string) []any {
	return metaInlines(s)["c"].([]any)
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}
