// =============================================================
// SOKUGAN — 外部サービス設定（公開して安全な値だけ）
// =============================================================
// ここに置いてよいのは anon key（公開前提の鍵）だけ。
// service_role key や DBパスワードは絶対に置かない（RLSを迂回できてしまう）。
// anon key が公開でも安全なのは、Supabase側で Row Level Security を有効にし、
// 「自分の行しか読み書きできない」ポリシーを張っているため（supabase/schema.sql）。
//
// 空のままでもアプリは完全に動作する（localStorage単独＝従来どおり）。
// 値を入れた瞬間から端末間同期が有効になる。設定手順: supabase/セットアップ手順.md
window.SOKUGAN_CONFIG = {
  supabaseUrl: "",      // 例: https://xxxxxxxxxxxx.supabase.co
  supabaseAnonKey: ""   // 例: eyJhbGciOi...（Project Settings > API > anon public）
};
