# Bank integrations

Quaestor connects to banks through different handlers. Which handler serves your bank decides how the connection works and what you need to set it up:

| Your bank                                   | Documenation              | Bank integration source code                                         |
|---------------------------------------------|---------------------------|----------------------------------------------------------------------|
| Trade Republic                              | [Link](trade_republic.md) | [Link](../../source/backend/bank_handlers/trade_republic.py)         |
| Deutsche Flugsicherung GmbH retirement plan | [Link](dfs.md)            | [Link](../../source/backend/bank_handlers/dfs_handler.py)            |
| fin4u retirement plan (Alte Leipziger)      | [Link](fin4u.md)          | [Link](../../source/backend/bank_handlers/fin4u_handler.py)          |
| A manual account                            | [Link](manual.md)         | [Link](../../source/backend/bank_handlers/manual_handler.py)         |
| A German bank supporting FinTS              | [Link](fints.md)          | [Link](../../source/backend/bank_handlers/fints_handler.py)          |
| Anything else                               | [Link](enable_banking.md) | [Link](../../source/backend/bank_handlers/enable_banking_handler.py) |

The easiest way to find out which integration offers your bank, search for it in the [full bank catalog](https://quaestordocs.fschneider.me/banks.html) and look for the badge naming its integration.

Some banks are offered through both _FinTS_ and _Enable Banking_ and then appear twice in the picker. See [the docs](fints_vs_enable_banking.md) for how to decide between the two.

If your bank is not in the catalog at all, please [open an issue](https://github.com/felixschndr/quaestor/issues). If the bank offers some kind of public API, chances are a handler can be implemented for it.
