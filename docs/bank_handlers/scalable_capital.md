# Scalable Capital

Quaestor connects to Scalable Capital through the **official** [Scalable CLI](https://github.com/ScalableCapital/scalable-cli),
published and maintained by Scalable Capital itself, not a reverse-engineered library. The signed
CLI binary is baked into the Quaestor container image at build time (pinned version, SHA256
verified), runs locally on your server, and Quaestor talks to it directly — no third party is
involved.

> [!IMPORTANT]
> Before the first login you have to enable the Scalable CLI once in the Scalable web portal under
> **Profile → Security → Agentic Investing**. Without that, every login attempt fails.

There is nothing to type in: connecting works by opening a link and confirming the login in your
own browser (an OAuth2 device-code flow), the same way you would sign in to the CLI yourself.
Quaestor requests the CLI's **`--local-read-only`** mode for every login, which disables all
trading/order commands for that session on the CLI side.

Quaestor fetches your cash (Verrechnungskonto) balance, your holdings (one account per position)
with their current valuation and price history, your transaction history, and your
overnight/Tagesgeld savings account if you have one.

> [!NOTE]
> Scalable Capital is the only provider that needs the `sc` binary installed manually — and only
> when running Quaestor natively instead of in the container. Download the release archive for your
> platform from the [releases page](https://github.com/ScalableCapital/scalable-cli/releases),
> extract the `sc` binary, and point the `SCALABLE_CLI_INSTALL_DIR` environment variable at the
> directory containing it (it defaults to `<DATA_DIR>/scalable-cli`).
