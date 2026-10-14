import { compose } from "./composition.js";
const { app, config } = await compose();
await app.listen({ port: config.PORT, host: config.HOST });
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
