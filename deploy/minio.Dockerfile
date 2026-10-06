# MinIO built for older x86_64 CPUs (GOAMD64=v1). Phenom / pre-x86-64-v2 hosts
# cannot run modern glibc MinIO images ("CPU does not support x86-64-v2").
#
#   docker build --platform linux/amd64 -f deploy/minio.Dockerfile -t cadence-minio:prod deploy
FROM golang:1.24-alpine AS build
RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 --branch RELEASE.2024-12-18T13-15-44Z https://github.com/minio/minio.git .
ENV CGO_ENABLED=0 GOAMD64=v1
RUN go build -trimpath -o /minio .

FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=build /minio /usr/bin/minio
EXPOSE 9000 9001
ENTRYPOINT ["/usr/bin/minio"]
CMD ["server", "/data", "--console-address", ":9001"]
