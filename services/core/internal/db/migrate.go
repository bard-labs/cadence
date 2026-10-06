package db

import (
	"database/sql"
	"fmt"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func Migrate(databaseURL string, migrationsDir string) error {
	sqldb, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return err
	}
	defer sqldb.Close()
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	if err := goose.Up(sqldb, migrationsDir); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
