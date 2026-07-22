# Enable Banking

[Enable Banking](https://enablebanking.com) is a service that provides access to the **PSD2** interfaces of thousands of European banks.
PSD2 access normally requires an expensive banking license; Enable Banking offers it **free of charge for private customers**.
Unlike the other handlers, the connection is not direct: your Quaestor server talks to the Enable Banking API,
which talks to your bank. Your online-banking login happens on your bank's own website; Quaestor or Enable Banking never sees those credentials.
Nevertheless, your banking data is not shared with any other parties (e.g. the developers of Quaestor).

> [!IMPORTANT]
> Enable Banking **requires** Quaestor to be served over **HTTPS**; over plain HTTP the connection
> is rejected. See the [README](../../README.md#environment-variables) for how to enable HTTPS.

## One-time setup (~2 min)

**Every user** (not only the server admin) (to be compliant with the [terms of service of Enable Banking](https://enablebanking.com/terms/)) has to register their own **free** Enable Banking account:

1. Create a free account and register a new application in the [control panel](https://enablebanking.com/cp/applications).

   - Choose your application's environment.: `Production`
   - Choose how to generate a private RSA key and a certificate for your new application (used for signing and verifying JWT authorizing API calls).: `Generate in the browser (using SubtleCrypto) and export private key`
   - Fill out information about your application.
     - Application name: `Quaestor`
     - Allowed redirect URLs: `https://<your instance>/banking/callback`
       - This URL without the placeholder is shown in the frontend when create a new credential that uses the Enable Banking Handler
     - Application description: `https://github.com/felixschndr/quaestor`
     - Email for data protection matters: `<your mail address>`
     - Privacy URL of the application: `https://github.com/felixschndr/quaestor`
     - Terms URL of the application: `https://github.com/felixschndr/quaestor/blob/main/LICENSE`
     - `Register`
     - The key file (`.pem`) is downloaded automatically when creating the application.
2. Add your bank via the `Link accounts` button in the control panel.
3. In Quaestor, pick your bank and upload the key file. When connecting you are redirected to your bank to sign in.

When you want to add further banks in the future, your existing application is reused. Thus,
1. link the new account in control panel of Enable Banking
2. add the bank in Quaestor (no need to import the key file again)
