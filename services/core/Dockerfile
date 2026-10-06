FROM golang:1.26-alpine AS build
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/api ./cmd/api
RUN CGO_ENABLED=0 go build -o /bin/worker ./cmd/worker

FROM alpine:3.21 AS api
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 cadence
WORKDIR /app
COPY --from=build /bin/api /app/api
USER cadence
EXPOSE 8080
ENTRYPOINT ["/app/api"]

FROM alpine:3.21 AS worker
RUN apk add --no-cache ca-certificates ffmpeg && adduser -D -u 10001 cadence
WORKDIR /app
COPY --from=build /bin/worker /app/worker
USER cadence
ENTRYPOINT ["/app/worker"]
