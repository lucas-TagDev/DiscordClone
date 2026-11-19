// Extensões que o navegador pode executar como página/script quando o arquivo é aberto
// direto pela URL (/uploads/...). Como os uploads ficam no mesmo domínio do app, um
// .html ou .svg com <script> rodaria logado como quem abrisse o link.
const EXECUTABLE_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".xhtml",
  ".shtml",
  ".xht",
  ".svg",
  ".svgz",
  ".xml",
  ".xsl",
  ".xslt",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".php",
  ".phtml",
  ".asp",
  ".aspx",
  ".jsp",
  ".cgi",
  ".pl",
  ".py",
  ".sh",
  ".swf",
  ".hta",
  ".mht",
  ".mhtml",
]);

/**
 * Devolve uma extensão segura para gravar o arquivo em disco.
 * Extensões executáveis viram ".txt" (o arquivo continua baixável, mas não roda).
 */
export const getSafeUploadExtension = (extension: string): string => {
  const normalized = extension
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 16);

  if (!normalized || normalized === ".") {
    return "";
  }

  if (EXECUTABLE_EXTENSIONS.has(normalized)) {
    return `${normalized.replace(/\./g, "_")}.txt`;
  }

  return normalized.startsWith(".") ? normalized : `.${normalized}`;
};
