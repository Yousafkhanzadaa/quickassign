# syntax=docker/dockerfile:1
FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN go vet ./... && go test ./... \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/sandbox .

# Official pandoc image with TeX Live (XeLaTeX). Runtime has no network, so everything
# the template needs is installed and exercised here at build time.
FROM pandoc/latex:3.11.0.0-debian
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils fontconfig \
 && rm -rf /var/lib/apt/lists/*
# Only the packages the base image lacks; try fixed mirrors in order (no random mirror).
RUN set -e; for m in https://mirrors.mit.edu/CTAN https://mirrors.rit.edu/CTAN \
                     https://ctan.math.illinois.edu https://mirror.ox.ac.uk/sites/ctan.org; do \
      if tlmgr --repository "$m/systems/texlive/tlnet" install lastpage enumitem mathtools; then \
        ok=1; break; fi; echo "mirror $m failed, trying next"; done; \
    test "${ok:-0}" = 1; \
    for f in lastpage.sty enumitem.sty mathtools.sty soul.sty; do kpsewhich "$f" >/dev/null; done
COPY templates /app/templates
COPY --from=build /out/sandbox /app/sandbox
COPY warmup.md /app/warmup.md
# Warm-up: prove the full pipeline works offline before the image ships.
RUN mkdir -p /tmp/warm && cd /tmp/warm \
 && pandoc --sandbox -f markdown-raw_tex-raw_html-raw_attribute+tex_math_dollars -t latex \
      --template /app/templates/qa.latex -M title=Warmup -o doc.tex /app/warmup.md \
 && openin_any=p openout_any=p shell_escape=f xelatex -no-shell-escape -interaction=nonstopmode -halt-on-error doc.tex >/dev/null \
 && test -s doc.pdf \
 && pandoc --sandbox -f markdown -t docx -o doc.docx /app/warmup.md && test -s doc.docx \
 && pdftotext doc.pdf - | grep -q "Question 1" \
 && cd / && rm -rf /tmp/warm \
 && useradd --system --uid 10001 --no-create-home sandbox
USER 10001:10001
ENV SANDBOX_WORKDIR=/tmp
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/app/sandbox", "healthcheck"]
ENTRYPOINT ["/app/sandbox"]
