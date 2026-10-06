package httpapi

import (
	"context"

	"github.com/bardiamardan/bardlabs-cadence/services/core/internal/auth"
)

type ctxKey int

const sessionKey ctxKey = 1

func withSession(ctx context.Context, s auth.Session) context.Context {
	return context.WithValue(ctx, sessionKey, s)
}

func sessionFrom(ctx context.Context) auth.Session {
	return ctx.Value(sessionKey).(auth.Session)
}
