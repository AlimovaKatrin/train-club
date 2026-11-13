<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Качество кода проекта

При разработке и изменении кода соблюдать раздел «14. Качество кода и архитектуры» в [REQUIREMENTS.md](REQUIREMENTS.md#14-качество-кода-и-архитектуры): простые решения, понятные имена, разделение ответственности и явная логика без ненужных слоёв и абстракций. Изменения должны оставаться соразмерны задаче; общий рефакторинг не добавлять к ней автоматически.

Весь код, включая сложные алгоритмы, SQL, тесты и скрипты, должен легко читаться. Читаемость важнее краткости: использовать ясные последовательные шаги и именованные промежуточные значения; избегать запутанных выражений, вложенных тернарных операторов и цепочек, скрывающих логику. Не подменять понятность обилием комментариев или мелких обёрток.
