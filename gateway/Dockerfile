# syntax=docker/dockerfile:1
FROM golang:1.26.10-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
RUN go test ./... \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/gateway ./cmd/gateway \
 && mkdir -p /out/data/sessions

# Distroless: no shell, no package manager, runs as an unprivileged user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/gateway /gateway
COPY --from=build --chown=65532:65532 --chmod=0700 /out/data/sessions /data/sessions
USER 65532:65532
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["/gateway", "healthcheck"]
ENTRYPOINT ["/gateway"]
