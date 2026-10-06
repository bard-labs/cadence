package httpapi

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRequestTimeout(t *testing.T) {
	t.Run("writes 504 when the handler never responds", func(t *testing.T) {
		h := requestTimeout(15 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusGatewayTimeout {
			t.Fatalf("status = %d, want 504", rec.Code)
		}
	})

	t.Run("does not overwrite a response the handler already sent", func(t *testing.T) {
		h := requestTimeout(15 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			<-r.Context().Done()
		}))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	})

	t.Run("does not write after the connection is hijacked", func(t *testing.T) {
		h := requestTimeout(15 * time.Millisecond)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			hj, ok := w.(http.Hijacker)
			if !ok {
				t.Fatal("response writer does not support hijack")
			}
			if _, _, err := hj.Hijack(); err != nil {
				t.Fatal(err)
			}
			<-r.Context().Done()
		}))
		rw := &recordHijacker{header: make(http.Header)}
		h.ServeHTTP(rw, httptest.NewRequest(http.MethodGet, "/", nil))
		if rw.code != 0 {
			t.Fatalf("wrote status %d on a hijacked connection", rw.code)
		}
	})
}

type recordHijacker struct {
	header http.Header
	code   int
}

func (r *recordHijacker) Header() http.Header { return r.header }
func (r *recordHijacker) Write(b []byte) (int, error) {
	r.code = http.StatusOK
	return len(b), nil
}
func (r *recordHijacker) WriteHeader(code int) { r.code = code }
func (r *recordHijacker) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	return nil, nil, nil
}
