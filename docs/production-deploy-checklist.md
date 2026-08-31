# F-Doc — Checklist deploy production (toàn bộ ứng dụng)

Checklist đầy đủ để đưa F-Doc lên production. Nếu chỉ cần bật riêng MCP/OAuth trên một instance đã chạy ổn, xem [mcp-production-checklist.md](./mcp-production-checklist.md) thay vì file này.

## 1. Hạ tầng nền

F-Doc cần 3 thành phần chạy cùng lúc: ứng dụng (Docker image build từ `Dockerfile`), **Postgres**, **Redis**. `docker-compose.yml` ở root repo có mẫu đầy đủ cho cả 3 — nhưng **chứa giá trị demo, không dùng thẳng cho production**:

```yaml
# docker-compose.yml hiện tại — CHỈ DÙNG THAM KHẢO, phải đổi trước khi deploy thật
APP_SECRET: '3a3d88225a5ee7886a168434b9bdc0ff2508a1aace1232f1c5f32dc79bda5860'
POSTGRES_PASSWORD: 9be5e2f9423532b81fe93ac3492964fb
```

- [ ] Sinh `APP_SECRET` mới: `openssl rand -hex 32` (tối thiểu 32 ký tự theo `.env.example`)
- [ ] Đổi `POSTGRES_PASSWORD` sang giá trị mạnh, không dùng chung với bất kỳ repo/demo nào khác
- [ ] Postgres và Redis nên có backup tự động (`db_data`/`redis_data` volume trong compose chỉ là local disk, không phải backup)
- [ ] Xác nhận version Postgres tương thích — compose mẫu dùng `postgres:18`

## 2. Database migration (bắt buộc, không tự động chạy)

`start:prod` (`node dist/main`) **không tự chạy migration**. Nếu deploy thẳng bằng lệnh `start` mà chưa migrate, app sẽ crash ngay khi kết nối DB vì thiếu bảng.

```bash
# Chạy 1 lần trước mỗi lần deploy có migration mới (kể cả lần đầu)
pnpm --filter server run migration:latest
```

- [ ] Đưa bước migration vào pipeline CI/CD (chạy trước khi start service mới, hoặc dùng init container/job riêng)
- [ ] Có kế hoạch rollback nếu migration lỗi giữa chừng (`migration:down`)

## 3. Biến môi trường — theo nhóm chức năng

`.env.example` có 35 biến. Nhóm theo mức độ bắt buộc:

### Bắt buộc, mọi deployment

```bash
APP_URL=https://docs.yourcompany.com   # domain thật, không có dấu / cuối — dùng cho OAuth discovery, link email, v.v.
PORT=3000
APP_SECRET=<openssl rand -hex 32>      # KHÔNG dùng giá trị mẫu trong docker-compose.yml
DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/f-doc?schema=public"
REDIS_URL=redis://<host>:6379
```

### File storage — chọn 1 driver

```bash
STORAGE_DRIVER=local   # options: local | s3 | azure
```

- [ ] `local`: cần volume persistent thật (không phải ephemeral container disk) — mất volume = mất toàn bộ file đính kèm/ảnh đã upload, kể cả ảnh MCP tự tạo qua `upload_attachment`
- [ ] `s3`: điền `AWS_S3_ACCESS_KEY_ID`, `AWS_S3_SECRET_ACCESS_KEY`, `AWS_S3_REGION`, `AWS_S3_BUCKET`, `AWS_S3_ENDPOINT` (nếu dùng S3-compatible như MinIO/R2), `AWS_S3_FORCE_PATH_STYLE`
- [ ] `azure`: điền `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`, `AZURE_STORAGE_CONTAINER`
- [ ] `FILE_UPLOAD_SIZE_LIMIT` — để trống sẽ dùng mặc định 50mb, **nhưng lưu ý bug đã sửa**: để trống bằng chuỗi rỗng `""` (không phải bỏ hẳn dòng) từng khiến upload luôn bị từ chối — nếu set biến này, phải set giá trị thật (`50mb`) hoặc xoá hẳn dòng khỏi `.env`, không để `=` trống

### Email — chọn 1 driver

```bash
MAIL_DRIVER=smtp   # options: smtp | postmark
MAIL_FROM_ADDRESS=hello@yourcompany.com
MAIL_FROM_NAME=F-Doc
```

- [ ] SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_SECURE`, `SMTP_IGNORETLS`
- [ ] Postmark: `POSTMARK_TOKEN`
- [ ] Test gửi thử email quên mật khẩu / mời thành viên sau khi deploy — driver sai âm thầm fail nếu không test

### Tuỳ chọn / theo nhu cầu

| Biến | Khi nào cần |
|---|---|
| `DRAWIO_URL` | Nếu dùng sơ đồ Draw.io nhúng trong trang |
| `GOTENBERG_URL` | Nếu cần export PDF phía server |
| `JWT_TOKEN_EXPIRES_IN` | Mặc định `30d`, chỉnh nếu chính sách bảo mật yêu cầu ngắn hơn |
| `DISABLE_TELEMETRY` | `true` nếu không muốn gửi telemetry |
| `IFRAME_EMBED_ALLOWED` + `IFRAME_ALLOWED_ORIGINS` | Chỉ bật nếu cần nhúng F-Doc vào trang khác (intranet/portal) |
| `DEBUG_MODE`, `DEBUG_DB`, `LOG_HTTP` | Để `false` ở production — bật tạm khi cần debug sự cố |

## 4. HTTPS / TLS

`docker-compose.yml` mẫu chỉ expose port 3000 nội bộ, không có TLS termination. Cần một trong:

- [ ] Reverse proxy (Nginx/Caddy/Traefik) trước app, chứng chỉ qua Let's Encrypt
- [ ] Load balancer/CDN xử lý TLS (Cloudflare, ALB...) rồi forward HTTP nội bộ

> Nếu team cũng đang bật MCP: reverse proxy phải forward **toàn bộ domain**, không chỉ `/api/*` — chi tiết ở [mcp-production-checklist.md](./mcp-production-checklist.md#2-cấu-hình-reverse-proxy-bắt-buộc).

## 5. Build & container

- [ ] Build image bằng `Dockerfile` có sẵn (`docker build .`) — image dùng `node:26-slim`, chạy user không phải root (`USER node`)
- [ ] Volume `/app/data/storage` phải mount persistent nếu `STORAGE_DRIVER=local`
- [ ] Image expose port `3000` — map ra port ngoài theo hạ tầng thật

## 6. Sau khi deploy — kiểm tra

```bash
# Health check cơ bản
curl -s https://docs.yourcompany.com/api/health
# → {"status":"ok","info":{"database":{"status":"up"},"redis":{"status":"up"}}}
```

- [ ] Đăng nhập được, tạo trang được, upload file được (test cả 3 luồng chính)
- [ ] Gửi thử email (quên mật khẩu)
- [ ] Nếu bật MCP: chạy thêm 3 lệnh kiểm tra trong [mcp-production-checklist.md](./mcp-production-checklist.md#6-kiểm-tra-sau-khi-deploy)

## 7. Vận hành lâu dài

- [ ] Backup Postgres định kỳ (không chỉ dựa vào volume Docker)
- [ ] Backup storage (S3 versioning, hoặc backup volume `local` định kỳ)
- [ ] Log tập trung (không chỉ đọc `docker logs`)
- [ ] Alerting khi `/api/health` fail
- [ ] Quy trình rotate `APP_SECRET` nếu bị lộ (sẽ làm mọi session/OAuth token hiện tại hết hạn)
