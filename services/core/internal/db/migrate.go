package db

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"github.com/bardiamardan/bardlabs-cadence/services/core/db"
)

// Migrate applies embedded migrations, so the binary does not depend on its working directory.
func Migrate(databaseURL string) error {
	sqldb, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer sqldb.Close()
	goose.SetBaseFS(db.Migrations)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.Up(sqldb, "migrations"); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
