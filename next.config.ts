import type { NextConfig } from "next";

// Сайт собирается в статическую папку `out/` и отдаётся как файлы: сервера
// Next.js в проде нет. `trailingSlash` кладёт каждую страницу в
// `<путь>/index.html`, чтобы её нашёл любой статический сервер без правил
// переписывания.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
