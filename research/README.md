# Research & Guides Index — vscode-officefiles

Design research (from studying [cweijan/vscode-office](https://github.com/cweijan/vscode-office)) plus operational guides for the OfficeFiles project.

## Design research
| Doc | Level | Contents |
|---|---|---|
| [01-architecture-overview.md](01-architecture-overview.md) | High-level | Two-process model, provider splits, build system, original's weaknesses |
| [02-component-design.md](02-component-design.md) | Mid-level | Handler event bus, providers/services, React view tree, theming bridge |
| [03-lowlevel-details.md](03-lowlevel-details.md) | Low-level | `{type,content}` envelope protocol, applyEdit pattern, binary handling |
| [04-agent-mcp-control.md](04-agent-mcp-control.md) | Feature design | MCP/LM-tools surfaces, tool vocabulary, permission tiers |
| [05-project-plan.md](05-project-plan.md) | Plan | MVP scope, deviations for robustness/features, milestones M0–M6 |
| [09-feature-adoption-plan.md](09-feature-adoption-plan.md) | Plan | Feature-adoption plan (viewer/editor parity with the reference) |
| [10-human-agent-capability-report.md](10-human-agent-capability-report.md) | Report | What ships today for humans (viewers/editors) and agents (commands, LM tools, MCP) — read/write matrix, paths, safety, connection, limits |

## Operational guides (how to deploy & connect)
| Doc | Audience | Contents |
|---|---|---|
| [06-deployment-guide.md](06-deployment-guide.md) | Devs/IT | Build gates, `.vsix` packaging, local/team/marketplace/enterprise install, CI/CD pipeline, upgrades, uninstall |
| [07-agent-connection-guide.md](07-agent-connection-guide.md) | Agent integrators | Four agent surfaces: Copilot LM tools, commands, external MCP → live editors (IPC proxy), headless standalone MCP; configs for Claude Desktop/Cursor/Zed; security model; recipes |
| [08-troubleshooting-faq.md](08-troubleshooting-faq.md) | Everyone | Symptom→check→fix for build, install, MCP connection, data integrity, performance |

**Start here:** deploy a package → §06; connect an agent → §07; something broke → §08.
