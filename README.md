# FURY · Click Hero — Webhook Takedown Service

Serviço backend responsável por receber webhooks de violações de anúncios, realizar a validação estrita dos contratos, gerenciar o enfileiramento resiliente de tarefas assíncronas e monitorar o status do processamento.

## 🛠️ Stack Técnica

| Tecnologia | Uso |
| :--- | :--- |
| **Node.js + TypeScript** | Ambiente de execução e API principal (Express) |
| **BullMQ + Redis** | Gerenciamento de filas e orquestração assíncrono |
| **PostgreSQL + Drizzle** | Persistência relacional e auditoria histórica dos status |
| **Zod** | Validação em runtime dos payloads de entrada |
| **Pino** | Logs estruturados em formato JSON para ambiente de produção |

---

## 🏗️ Fluxo de Dados

```text
1. Webhook (Meta)
   ↓
2. Validação Zod
   ↓
3. Checagem de Idempotência
   ├── (Status: PROCESSING/COMPLETED) ➔ Retorna 200 OK
   ↓
4. Enfileiramento (BullMQ / Redis)
   ↓
5. Worker BullMQ
   ├── ➔ Dispara chamada HTTP para API Externa
   └── ➔ Atualiza status final no PostgreSQL
```

---

## 🔒 Estratégia de Idempotência & Concorrência

Para mitigar o recebimento de requisições simultâneas idênticas enviadas em janelas de milissegundos (cenário comum em webhooks de plataformas de Ads), o sistema opera em duas camadas:

1. **Otimização de Leitura (Postgres):** O controlador realiza uma busca rápida na tabela `ad_takedowns` utilizando o identificador único gerado. Se o status já constar como `PROCESSING` ou `COMPLETED`, a API retorna `200 OK` imediatamente, descartando o overhead da fila.
2. **Trava Atômica (Redis):** Caso requisições idênticas passem pela checagem do banco simultaneamente devido a uma condição de corrida (*Race Condition*), o `jobId` dentro da fila do BullMQ é fixado de forma determinística como `takedown:${tenantId}:${adId}`. O Redis bloqueia nativamente o enfileiramento duplicado do mesmo ID em memória.

---

## ⚙️ Política de Retries e Resiliência

O comportamento do Worker diante de falhas na integração com a API externa é baseado na semântica HTTP:

* **HTTP 4xx (Erro de Negócio):** Tratado como falha terminal. O sistema atualiza o status para `FAILED` no banco de dados e encerra o job imediatamente, pois o payload ou as credenciais foram rejeitados e novas tentativas teriam o mesmo resultado.
* **HTTP 5xx / Timeout (Erro de Infraestrutura):** A requisição utiliza um limite de tempo estrito de **5000ms via AbortController**. Caso o tempo seja extrapolado ou a API externa apresente instabilidade temporária, o erro é lançado para que o BullMQ acione a política de **Retry com Backoff Exponencial** por até 3 tentativas antes de marcar o job como falhado.

---

## ⚖️ Trade-offs Arquiteturais (Justificativa de Infraestrutura)

* **Uso Proposital do PostgreSQL:** Embora a especificação do desafio isentasse a obrigatoriedade de um banco de dados, optou-se por incluir o PostgreSQL rodando com Drizzle ORM. Essa decisão foi tomada para ancorar a idempotência de forma absoluta através de uma constraint única transacional (`ON CONFLICT DO NOTHING`) na camada de dados. Isso evita o risco de perda de estado que ocorreria se controlássemos os status históricos apenas na memória volátil do Redis.
* **Tratamento de Orphan Jobs (Gap de Latência):** No fluxo de ingestão, o registro é criado no banco de dados milissegundos antes do enfileiramento real no BullMQ. Em um cenário real de produção, caso o container sofresse um crash exatamente entre essas duas linhas de código, o registro ficaria travado como `PENDING` indefinidamente. Para mitigar isso mantendo a simplicidade, assume-se como trade-off a necessidade de um processo periódico de reconciliação (cron) para reinjetar na fila registros estagnados em `PENDING`.

---

## 🚀 Passo a Passo para Execução Local

### Pré-requisitos Obrigatórios

O usuário deve possuir instalado em sua máquina local:

* **Docker** e **Docker Compose**
* **Node.js** (versão 20 ou superior)

### 1. Clonar o repositório e acessar a pasta

```bash
git clone <link-do-seu-repositorio>
cd <nome-da-pasta-do-projeto>
```

### 2. Instalar as dependências do Node.js

```bash
npm install
```

### 3. Subir a Infraestrutura via Docker

Este comando inicializa os containers isolados do **PostgreSQL** e do **Redis** em background:

```bash
docker-compose up -d
```

### 4. Gerar e Executar as Migrações do Banco de Dados

Gera os arquivos SQL do Drizzle baseados no schema e estrutura as tabelas dentro do banco PostgreSQL local:

```bash
npm run db:generate
npm run db:migrate
```

### 5. Iniciar a Aplicação (API + Worker)

Executa o ambiente de desenvolvimento local com hot-reload ativo:

```bash
npm run dev
```

---

## 🎯 Exemplos de Uso

> 💡 **Dica para Avaliadores:** Para facilitar os testes manuais da API, disponibilizamos um arquivo [`requests.http`](./requests.http) na raiz do projeto. Se estiver utilizando o VS Code com a extensão *REST Client* (ou IntelliJ), basta abrir o arquivo e clicar em "Send Request" para testar todas as rotas (POST e GET) diretamente do editor, sem precisar configurar o Postman.

### Ingestão de Violação (`POST /webhook/violation`)

```json
// POST http://localhost:3000/webhook/violation
{
  "adId": "123",
  "tenantId": "abc",
  "violationType": "BRAND_VIOLATION",
  "severity": "HIGH",
  "detectedAt": "2026-05-23T15:30:00Z"
}
```

### Consulta de Status (`GET /jobs/:id`)

O parâmetro `:id` da rota deve receber a string do `jobId` determinístico gerado no formato `takedown:tenantId:adId`.

```text
GET http://localhost:3000/jobs/takedown:abc:123
```

```json
// Retorno esperado (Status COMPLETED)
{
  "jobId": "takedown:abc:123",
  "status": "COMPLETED",
  "attempts": 1,
  "result": { "userId": 1, "id": 1, "title": "...", "body": "..." },
  "error": null
}
```

---

## 🧪 Testes e Validação

Para rodar a suite de testes automatizados e a validação de tipos do compilador:

```bash
# Validação estrita de tipos do TypeScript
npm run typecheck

# Execução dos testes de integração e concorrência real
npm test
```

### 🤖 Integração Contínua (CI/CD)

O repositório conta com um fluxo de **GitHub Actions** (`.github/workflows/ci.yml`) que atua como barreira de segurança. A cada *push* ou *pull request* na branch principal, a esteira automatizada sobe os containers do Postgres e Redis em nuvem, executa as migrações, valida a tipagem e roda todos os testes. Só é possível fazer deploy se a pipeline aprovar 100% da suíte.
