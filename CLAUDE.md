# Logistica — Instrucciones para Claude

## Flujo de trabajo obligatorio

**Después de cada push a GitHub, siempre crear una Pull Request.**

Pasos en orden:
1. Hacer los cambios
2. Commit con mensaje descriptivo
3. Push al branch de trabajo (`claude/review-repository-x9JWi` u otro branch feature)
4. **Crear PR** apuntando a `main`, con título y descripción claros en español

Usar siempre `mcp__github__create_pull_request` para crear la PR.

## Repositorio

- Owner: `poldani2024`
- Repo: `Logistica`
- Branch de trabajo: `claude/review-repository-x9JWi`
- Base branch para PRs: `main`

## Push

El `git push` normal falla (403). Usar siempre el token configurado:

```bash
git remote set-url origin "https://poldani2024:TOKEN@github.com/poldani2024/Logistica.git"
git push -u origin BRANCH
git remote set-url origin "http://local_proxy@127.0.0.1:PORT/git/poldani2024/Logistica"
```

## Contexto del proyecto

Sistema web de gestión de transporte para la Soka Gakkai de Rosario.
Stack: JavaScript ES6 modules + Firebase Firestore + Firebase Auth.
Sin build tools — módulos cargados directamente por el browser.
