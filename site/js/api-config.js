(function () {
  const host = window.location.hostname;
  const isLocal = host === "localhost" || host === "127.0.0.1";

  // Локально — API на вашем ПК. На проде — URL сервера API (H1Cloud/VPS рядом с ботом).
  // Cloudflare для статики не даёт runtime-переменные — меняйте URL здесь перед деплоем.
  const PROD_API = "https://api.fastvpn.example.com";

  window.FASTVPN_API = isLocal ? "http://localhost:8787" : PROD_API;
})();
