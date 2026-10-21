import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, sep, extname } from "node:path";

/** Local static example server, also used by browser tests. */
export function createExampleServer() {
  const base = fileURLToPath(new URL("../", import.meta.url));
  const types = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/") {
        res.writeHead(302, { location: "/examples/index.html" });
        res.end();
        return;
      }
      if (url.pathname === "/echo") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            message: "Hello from a synthetic response",
            items: [
              { id: 1, name: "Blue" },
              { id: 2, name: "Green" },
            ],
          }),
        );
        return;
      }
      const path = resolve(
        base,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/examples/index.html" : url.pathname,
          ),
      );
      if (
        !["src", "examples"].some((directory) =>
          path.startsWith(resolve(base, directory) + sep),
        ) ||
        !Object.hasOwn(types, extname(path))
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      if (!(await stat(path)).isFile()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "content-type": types[extname(path)] ?? "application/octet-stream",
      });
      res.end(await readFile(path));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173),
    server = createExampleServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `Web Network Inspector: http://127.0.0.1:${server.address().port}`,
    ),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close());
}
