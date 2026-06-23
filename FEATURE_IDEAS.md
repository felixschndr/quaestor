# Feature-Ideen für Quaestor

> Stand: 2026-06-23 · Brainstorming/Backlog, noch keine Entscheidung getroffen.
> Basis: Analyse der aktuellen Codebase + Vergleich mit Competitor [Actual Budget](https://actualbudget.org/).

## TL;DR

Quaestor ist heute ein starkes **read-only Tracking- & Vermögens-Tool** (Bank-Sync via FinTS/Trade Republic, Net-Worth, Balance-on-any-date, gute Security). Was fehlt, ist die **planende, vorausschauende Seite** – genau die Domäne, in der Actual Budget stark ist. Größter Hebel: **Budgets**.

---

## Wo Quaestor heute steht

**Stärken**
- Automatische Bank-Anbindung: FinTS, Trade Republic, DFS/fin4u Rentenpläne, manuelle Konten
- Vermögensübersicht: Net Worth + Trend, Balance-on-any-date (3 Quellen: bank-reported / computed / market-valued)
- Statistiken: Kategorie-Breakdown, Cashflow, Net-Savings (Recharts)
- Transaktionen: Suche/Filter, Auto-Kategorisierung (Regex), Transfer-Erkennung, Recurring & Expected/Future Transactions
- Security: 2FA (TOTP + Backup-Codes), SQLcipher-Verschlüsselung at-rest, API-Keys, CSRF, Rate-Limiting, Session-Management
- UX: React 19, Tailwind, i18n (DE/EN), Dark Mode, PWA, responsive

**Tech-Stack:** Python 3.14 / FastAPI / SQLAlchemy / Alembic + React 19 / TypeScript / TanStack Router+Query / Tailwind+Radix · SQLite (SQLcipher, verschlüsselt)

**Kern-Entitäten:** User, Credential, Account, Transaction, RecurringTransaction, TransactionCategory (24 Kategorien), AccountBalanceSnapshot, AccountGroup, Session, ApiKey, BackupCode, TwoFactorChallenge

---

## Gap-Analyse: Actual Budget vs. Quaestor

| Feature                                                 | Actual Budget     | Quaestor heute                            |
|---------------------------------------------------------|-------------------|-------------------------------------------|
| **Envelope-/Zero-Based Budgeting** + Rollover           | ✅ Kern-Feature    | ❌ gar nicht                               |
| **Rules-Engine** (Auto-Tagging, if/then, Payee-Mapping) | ✅ mit UI          | ⚠️ nur Regex im Backend, nicht editierbar |
| **Reconciliation** (Ist-Saldo mit Bank abgleichen)      | ✅                 | ❌                                         |
| **Payees** als eigene Entität                           | ✅                 | ❌ (nur `other_party` Freitext)            |
| **Import** QIF/OFX/QFX/CSV/CAMT.053                     | ✅                 | ❌                                         |
| **Export** (CSV/Excel)                                  | ✅                 | ❌                                         |
| **Custom Report Builder**                               | ✅                 | ⚠️ feste Charts                           |
| **Undo-System**                                         | ✅ alle Änderungen | ❌                                         |
| **Sparziele / Goal Templates**                          | ✅                 | ❌                                         |
| **Alerts/Notifications**                                | teilw.            | ❌                                         |

---

## Feature-Ideen (priorisiert nach Wirkung / Aufwand)

### 1. Budgets  ⭐ größter Hebel
Macht aus „Konto-Viewer" einen „Finanz-Manager". Baut direkt auf vorhandenen Daten (24 Kategorien + Statistik-Aggregationen) auf.
- Monatliches Budget/Limit pro Kategorie, Ist-vs-Soll, Fortschrittsbalken
- Optional: Rollover (Restbetrag in Folgemonat), Richtung Envelope-Modell ausbaubar
- Nutzt vorhandene Kategorie-Logik aus `statistics.py`
- **Aufwand:** mittel-hoch · **Wirkung:** sehr hoch

### 2. Editierbare Rules-Engine
Regex-Auto-Kategorisierung existiert schon im Backend – aber Nutzer kann sie nicht anpassen.
- UI: „Wenn Verwendungszweck/Gegenseite enthält X → Kategorie Y / Notiz Z"
- Logik teils vorhanden → günstiger Einstieg, hohe spürbare Wirkung
- **Aufwand:** niedrig-mittel · **Wirkung:** hoch

### 3. CSV/Excel-Export & Import
- **Export:** für Self-Hosted/Datenschutz-Tool fast Pflicht (Datenhoheit) – niedriger Aufwand
- **Import (CSV/OFX):** deckt Banken ohne FinTS-Support ab
- **Aufwand:** Export niedrig / Import mittel · **Wirkung:** mittel-hoch

### 4. Alerts / Benachrichtigungen
Infrastruktur vorhanden: WebSockets + Scheduler laufen bereits.
- Trigger: Budget überschritten, große Transaktion, Saldo unter Schwelle
- **Aufwand:** mittel · **Wirkung:** mittel

### 5. Sparziele (Goals)
- „5.000 € für Urlaub bis Dez" mit Fortschritt, anknüpfend an Net-Worth-Daten
- **Aufwand:** mittel · **Wirkung:** mittel

### Weitere Kandidaten (niedrigere Prio)
- **Reconciliation:** Ist-Saldo mit Bank-Auszug abgleichen, Differenzen finden
- **Duplikat-Erkennung** bei Transaktionen
- **Custom Report Builder** statt fester Charts
- **Undo-System** für Bearbeitungen

---

## Bewusst NICHT übernehmen (vorerst)
- **Multi-Device-Sync mit E2E-Encryption** – Actual ist local-first, Quaestor ist server-zentriert; anderer Architektur-Ansatz, großer Aufwand für unklaren Nutzen
- **Volles Payee-Datenmodell-Refactoring** – großer Umbau für moderaten Nutzen; Rules-Engine (#2) liefert viel davon günstiger

---

## Nächster Schritt
Wenn ein Feature ausgewählt ist (Empfehlung: **Budgets**), kann dazu ein konkreter Implementierungsplan erstellt werden: Datenmodell + Migration, API-Endpunkte, Frontend-Routen/Komponenten – passend zur bestehenden Architektur.

### Quellen
- [Actual Budget – Features](https://actualbudget.org/)
- [Envelope Budgeting](https://actualbudget.org/docs/getting-started/envelope-budgeting/)
- [Actual Budget – Release Notes](https://actualbudget.org/docs/releases/)
