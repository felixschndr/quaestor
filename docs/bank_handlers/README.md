# Bank handlers

Quaestor connects to banks through different handlers. Which handler serves your bank decides how the connection works and what you need to set it up:

| Your bank                                                          | Handler                                |
|--------------------------------------------------------------------|----------------------------------------|
| Trade Republic                                                     | [trade_republic.md](trade_republic.md) |
| Deutsche Flugsicherung GmbH retirement plan                        | [dfs.md](dfs.md)                       |
| fin4u retirement plan (Alte Leipziger)                             | [fin4u.md](fin4u.md)                   |
| A manual account                                                   | [manual.md](manual.md)                 |
| A German bank supporting FinTS (e.g. Deutsche Bank, ING, DKB, ...) | [fints.md](fints.md)                   |
| Anything else                                                      | [enable_banking.md](enable_banking.md) |

To find out which handler offers your bank, search for it in the [full bank catalog](https://quaestordocs.fschneider.me/banks.html) and look for the badge naming its handler.

If your bank is not in the catalog at all, please [open an issue](https://github.com/felixschndr/quaestor/issues). If the bank offers some kind of public API, chances are a handler can be implemented for it.
