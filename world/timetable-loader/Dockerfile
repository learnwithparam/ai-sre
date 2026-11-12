FROM golang:1.27.4-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /timetable-loader .

FROM alpine:3.24
COPY --from=build /timetable-loader /timetable-loader
EXPOSE 8001
CMD ["/timetable-loader"]
