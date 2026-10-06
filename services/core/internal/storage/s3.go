package storage

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const region = "us-east-1"

var ErrObjectMissing = errors.New("object not found")

type S3 struct {
	client    *minio.Client
	presigner *minio.Client
	bucket    string
	publicURL string
}

type Options struct {
	Endpoint       string
	PublicEndpoint string
	AccessKey      string
	SecretKey      string
	Bucket         string
	UseSSL         bool
	PublicURL      string
}

// New builds two clients: one for server-to-storage traffic and one whose host
// matches what browsers can reach, because presigned signatures cover the host.
func New(o Options) (*S3, error) {
	mk := func(endpoint string) (*minio.Client, error) {
		return minio.New(endpoint, &minio.Options{
			Creds:  credentials.NewStaticV4(o.AccessKey, o.SecretKey, ""),
			Secure: o.UseSSL,
			Region: region,
		})
	}
	client, err := mk(o.Endpoint)
	if err != nil {
		return nil, err
	}
	presigner, err := mk(o.PublicEndpoint)
	if err != nil {
		return nil, err
	}
	return &S3{client: client, presigner: presigner, bucket: o.Bucket, publicURL: o.PublicURL}, nil
}

// EnsureBucket creates the bucket and allows anonymous reads of transcoded HLS
// output only. Original uploads stay private.
func (s *S3) EnsureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return err
	}
	if !exists {
		if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{Region: region}); err != nil {
			return err
		}
	}
	policy := fmt.Sprintf(`{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":["*"]},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::%s/hls/*"]}]}`, s.bucket)
	return s.client.SetBucketPolicy(ctx, s.bucket, policy)
}

func (s *S3) Ping(ctx context.Context) error {
	_, err := s.client.BucketExists(ctx, s.bucket)
	return err
}

type UploadTarget struct {
	URL       string            `json:"url"`
	Fields    map[string]string `json:"fields"`
	ObjectKey string            `json:"objectKey"`
	MaxBytes  int64             `json:"maxBytes"`
}

func UploadPrefix(userID string) string {
	return "uploads/" + userID + "/"
}

func (s *S3) PresignUpload(ctx context.Context, userID string, maxBytes int64) (UploadTarget, error) {
	key := UploadPrefix(userID) + uuid.NewString()
	policy := minio.NewPostPolicy()
	if err := policy.SetBucket(s.bucket); err != nil {
		return UploadTarget{}, err
	}
	if err := policy.SetKey(key); err != nil {
		return UploadTarget{}, err
	}
	if err := policy.SetExpires(time.Now().UTC().Add(15 * time.Minute)); err != nil {
		return UploadTarget{}, err
	}
	if err := policy.SetContentLengthRange(1, maxBytes); err != nil {
		return UploadTarget{}, err
	}
	if err := policy.SetContentTypeStartsWith("audio/"); err != nil {
		return UploadTarget{}, err
	}
	u, fields, err := s.presigner.PresignedPostPolicy(ctx, policy)
	if err != nil {
		return UploadTarget{}, err
	}
	// The client must send the file's real Content-Type; the policy only
	// constrains its prefix, and S3 rejects duplicate form values.
	delete(fields, "Content-Type")
	return UploadTarget{URL: u.String(), Fields: fields, ObjectKey: key, MaxBytes: maxBytes}, nil
}

func (s *S3) ObjectSize(ctx context.Context, key string) (int64, error) {
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if minio.ToErrorResponse(err).Code == "NoSuchKey" {
			return 0, ErrObjectMissing
		}
		return 0, err
	}
	return info.Size, nil
}

func (s *S3) Download(ctx context.Context, key, dest string) error {
	return s.client.FGetObject(ctx, s.bucket, key, dest, minio.GetObjectOptions{})
}

func (s *S3) Upload(ctx context.Context, key, path, contentType, cacheControl string) error {
	_, err := s.client.FPutObject(ctx, s.bucket, key, path, minio.PutObjectOptions{
		ContentType:  contentType,
		CacheControl: cacheControl,
	})
	return err
}

func (s *S3) PublicURL(key string) string {
	if key == "" {
		return ""
	}
	return s.publicURL + "/" + key
}
