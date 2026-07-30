# PLUMB Real ConPTY Visual Evidence Report

## Metadata
- **Repository**: `D:\PLUMB-production`
- **Branch**: `rebuild/plumb-gemini-production`
- **Baseline Candidate HEAD**: `2e04f6a112d73c847ea926fe13e4fbddc6abd9a3`
- **Terminal Subsystem**: Windows ConPTY (`node-pty` native bindings)

---

## 1. ConPTY Execution Evidence Matrix

| Session ID | Surface | Viewport | Raw Log File Reference | Deterministic Frame SHA-256 | Exit Code | Terminal Restoration |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `01-w80x24` | Welcome | 80x24 | `docs/verification/evidence/01-welcome-80x24-raw.log` | `1bea042d35c2410cabd929094c5b4f7fba93b6c6f9d22fa32e15f9152370c35a` | `0` | Clean process exit |
| `02-w120x36` | Welcome | 120x36 | `docs/verification/evidence/02-welcome-120x36-raw.log` | `d488879698c1c84f286ff6b7892f6b7c6bb5338bce5662895238038971ff885d` | `0` | Clean process exit |
| `03-w160x50` | Welcome | 160x50 | `docs/verification/evidence/03-welcome-160x50-raw.log` | `d488879698c1c84f286ff6b7892f6b7c6bb5338bce5662895238038971ff885d` | `0` | Clean process exit |
| `04-nocolor` | NO_COLOR | 80x24 | `docs/verification/evidence/04-no-color-raw.log` | `65a6817b1ee6e481e3dd2a20a0b111f41bee4dd03b2a05f58fafa697127a74aa` | `0` | Clean process exit |

---

## 2. Actual Captured Frame Text

### Direction A (Geometric P + Plumb Bob Monogram)
```
┌─┐
│ │
├─┘
│  
▼  PLUMB
```

### Direction B (L Alignment Mark)
```
│   
│   
└──▼  PLUMB
```

### Direction C (Abstract Alignment Mark)
```
╷
│
◈  PLUMB
```
