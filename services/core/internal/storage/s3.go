package storage

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type S3 struct {
	client    *minio.Client
	bucket    string
	publicURL string
}

func New(endpoint, accessKey, secretKey, bucket string, useSSL bool, publicURL string) (*S3, error) {
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, err
	}
	return &S3{client: client, bucket: bucket, publicURL: publicURL}, nil
}

func (s *S3) EnsureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !exists {
		return s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{})
	}
	return nil
}

func (s *S3) PresignedUpload(ctx context.Context, contentType string) (objectKey string, uploadURL string, err error) {
	objectKey = fmt.Sprintf("uploads/%s/%s", time.Now().Format("2006/01/02"), uuid.New().String())
	u, err := s.client.PresignedPutObject(ctx, s.bucket, objectKey, 15*time.Minute)
	if err != nil {
		return "", "", err
	}
	return objectKey, u.String(), nil
}

func (s *S3) PublicURL(key string) string {
	if key == "" {
		return ""
	}
	return strings.TrimSuffix(s.publicURL, "/") + "/" + key
}

func (s *S3) Client() *minio.Client { return s.client }
func (s *S3) Bucket() string         { return s.bucket }
