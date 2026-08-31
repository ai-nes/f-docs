# F-Doc

## Chạy bằng Docker Compose

```bash
docker compose up -d
```

Ứng dụng sẽ chạy tại `http://localhost:3000`.

Trước khi chạy, sửa các biến môi trường trong `docker-compose.yml` (đặc biệt là `APP_SECRET` và mật khẩu database).

## Chạy cho phát triển (development)

Yêu cầu: Node.js, pnpm, PostgreSQL, Redis.

```bash
# cài dependencies
pnpm install

# copy file env mẫu và chỉnh sửa
cp .env.example .env

# chạy migration database
pnpm --filter ./apps/server run migration:latest

# chạy cả frontend và backend
pnpm dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
