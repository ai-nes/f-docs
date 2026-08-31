# MCP + OAuth — Checklist trước khi lên production

Những việc DevOps cần làm đúng để Claude Desktop / Claude.ai kết nối được vào MCP server của F-Doc.

> **Phạm vi**: file này chỉ nói về phần MCP/OAuth, giả định F-Doc đã chạy ổn định (DB, Redis, storage, HTTPS, email...). Nếu đang deploy F-Doc lần đầu, xem [production-deploy-checklist.md](./production-deploy-checklist.md) trước.

## 1. Biến môi trường (bắt buộc, chặn kết nối nếu sai)

File discovery OAuth (`/.well-known/oauth-authorization-server`) tự sinh `issuer`, `authorization_endpoint`, `token_endpoint` từ `APP_URL`. Nếu để `localhost`, Claude sẽ không tìm được endpoint thật.

```bash
# apps/server/.env — giá trị production
APP_URL=https://docs.yourcompany.com   # domain thật, không có dấu / ở cuối
APP_SECRET=<chuỗi ngẫu nhiên >= 64 ký tự>  # ký cả session JWT lẫn OAuth JWT — KHÔNG dùng giá trị demo trong docker-compose.yml
```

> **Quan trọng**: `docker-compose.yml` mẫu có sẵn `APP_SECRET` demo. Nếu giá trị đó từng chạy ở đâu có thể truy cập được, phải đổi ngay — ai có secret này có thể giả mạo token của bất kỳ user nào.

## 2. Cấu hình reverse proxy (bắt buộc)

4 route này được cố tình đặt **ngoài** prefix `/api`, nằm ở gốc domain — đúng theo chuẩn MCP client mong đợi. Nếu reverse proxy chỉ forward `/api/*`, các route này sẽ trả 404.

| Path | Mục đích |
|---|---|
| `/mcp` | Endpoint chính, MCP JSON-RPC (POST) |
| `/.well-known/oauth-authorization-server` | Discovery OAuth server (RFC 8414) |
| `/.well-known/oauth-protected-resource` | Discovery resource server (RFC 9728) |
| `/.well-known/oauth-protected-resource/mcp` | Discovery resource, riêng cho MCP |

**Cần forward toàn bộ domain vào backend, không chỉ `/api`.**

## 3. Phạm vi license stub (cần biết trước khi bật)

`apps/server/src/ee/licence/license.service.ts` là stub — báo **mọi** tính năng enterprise đã có license, không chỉ MCP. Đây là quyết định chủ ý, không phải lỗi, nhưng cần xác nhận trước khi lên production vì nó cũng mở khóa SSO, SCIM, audit logs, page permissions...

- Xác nhận người phụ trách compliance/bảo mật biết rằng mọi cờ tính năng EE đều hiện "đã mở khóa"
- Các tính năng chưa có code thật (cùng cơ chế `ee/` gate) sẽ chỉ no-op — kiểm tra trước khi giả định 1 toggle nào đó thực sự hoạt động

## 4. Consent screen tự động duyệt (cần biết trước khi mở rộng)

`GET /oauth/authorize` cấp quyền ngay khi có phiên đăng nhập hợp lệ — chưa có màn hình "Cho phép Claude truy cập F-Doc của bạn?" liệt kê tên client + scope yêu cầu. Vẫn yêu cầu đăng nhập tương tác thật (`@RequireSessionAuth()`, từ chối API key và OAuth token khác), nên không phải lỗ hổng mở toang — chỉ là thiếu bước xác nhận người dùng có thể mong đợi.

> Phù hợp cho rollout nội bộ trong team. Nên có màn hình consent thật trước khi mở self-serve signup hoặc bất kỳ workspace nào cần biết rõ "ai đã kết nối gì".

## 5. Luồng kết nối thực tế (tham khảo)

Setup một lần cho mỗi user, không cần copy ID nào cả:

```
Claude Desktop → Settings → Connectors → Add custom connector
  → nhập https://docs.yourcompany.com/mcp
  → trình duyệt tự mở → user đăng nhập F-Doc → bấm Allow
```

Token OAuth sinh ra gắn chặt với danh tính user + workspace đó — không có URL hay workspace ID nào cần gửi cho Claude qua chat sau này. Mọi lần gọi `tools/call` tiếp theo đã tự mang đúng context user/workspace.

## 6. Kiểm tra sau khi deploy

```bash
# 1. Discovery document trả về đúng domain thật
curl -s https://docs.yourcompany.com/.well-known/oauth-authorization-server | jq .issuer
# → phải in ra "https://docs.yourcompany.com", không phải localhost

# 2. Endpoint /mcp tồn tại và từ chối request chưa xác thực (không phải 404)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://docs.yourcompany.com/mcp
# → phải là 401, không phải 404

# 3. Dynamic client registration hoạt động
curl -s -X POST https://docs.yourcompany.com/api/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris":["https://example.com/callback"],"client_name":"probe"}' | jq .client_id
```

Cả 3 lệnh pass nghĩa là việc thêm connector trên Claude sẽ thành công tới bước redirect đăng nhập.
