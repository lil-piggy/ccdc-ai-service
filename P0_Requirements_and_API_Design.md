# 中债AIAI发行智能机器人 —— P0 功能需求文档与接口设计

> 基于 `AI+发行分析文档.docx` 与 `ccdc-ai-service` 现有架构，将 P0 级功能点细化为可开发落地的需求与接口。
> 适用对象：全栈工程师、后端开发、前端开发、产品经理。

---

## 一、文档说明

### 1.1 项目背景
`ccdc-ai-service` 作为中债智能金融助手（代号"小发"），已具备 AI 对话、知识库 RAG、文件解析（docx/pdf/图片 OCR）、Bond Codin 代码审计 Agent 等能力。本文件将前文分析的 P0 功能点转化为可直接进入开发排期的需求与接口设计。

### 1.2 P0 功能清单
| 序号 | 功能名称 | 核心价值 | 依赖现有模块 |
|------|----------|----------|--------------|
| P0-1 | 招标公告结构化提取 | 告别手工录入，统一招标日历 | 文件上传、OCR、文本解析 |
| P0-2 | 跨文档财务勾稽核查 | 秒级发现财务数据不一致 | 知识库 RAG、多文件解析 |
| P0-3 | 负面清单/合规红线初审 | 自动识别监管政策风险 | 知识库 RAG、规则引擎 |
| P0-4 | 地方债合规预检 | 专项债项目 AI 初审 | 知识库 RAG、报告生成 |

### 1.3 通用约定
- 所有接口均遵循 RESTful 风格。
- 所有写操作需携带 `Authorization: Bearer <JWT>`。
- 返回格式统一为 JSON，结构如下：
  ```json
  {
    "code": 200,
    "message": "success",
    "data": {}
  }
  ```
- 时间格式：`yyyy-MM-dd HH:mm:ss`。
- 货币/利率单位：金额默认元，利率默认 % 或 BP（接口中明确标注）。

---

## 二、P0-1 招标公告结构化提取

### 2.1 需求文档

#### 2.1.1 功能描述
用户上传债券招标公告文件（PDF、图片、Word），系统自动识别并提取关键字段，生成结构化的"债市招标日历"数据。支持单文件上传和批量上传。

#### 2.1.2 输入
- 公告文件：PDF / PNG / JPG / DOCX
- 公告来源（可选）：中债网、上海清算所、手动上传
- 公告日期（可选，系统可自动识别）

#### 2.1.3 输出
结构化 JSON，包含以下字段：

| 字段名 | 类型 | 说明 |
|--------|------|------|
| bond_code | string | 债券代码 |
| bond_name | string | 债券名称 |
| issuer | string | 发行人 |
| bond_type | enum | 国债/地方债/政金债/信用债 |
| issue_date | date | 招标日期 |
| issue_scale | decimal | 发行规模（亿元） |
| term | string | 期限，如"7Y" |
| bidding_method | enum | 荷兰式/美国式/混合式 |
| benchmark_rate | decimal | 基准利率（%） |
| basic_spread | decimal | 基本利差（BP） |
| is_reissue | boolean | 是否续发 |
| lead_underwriter | string | 主承销商 |
| underwriters | array | 承销团成员 |
| status | enum | 已提取/待确认/已忽略 |
| confidence | decimal | 提取置信度 0-1 |

#### 2.1.4 业务规则
1. 必须识别的字段：债券名称、招标日期、发行规模、招标方式。
2. 无法识别的字段保留为空，置信度低于 0.6 的字段标记为"待确认"。
3. 同一债券代码重复上传时，提示用户是否覆盖。
4. 批量上传时返回每个文件的提取结果列表。

#### 2.1.5 异常处理
- 文件格式不支持：返回 400，提示支持的格式。
- 文件解析失败：返回 422，记录失败原因。
- 关键字段全部缺失：标记为"提取失败"，允许人工补录。

---

### 2.2 接口设计

#### 2.2.1 上传并提取公告
```http
POST /api/announcement/extract
Content-Type: multipart/form-data
Authorization: Bearer <JWT>
```

**请求参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| files | file[] | 是 | 公告文件，最多 10 个 |
| source | string | 否 | 公告来源，默认 manual |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 2,
    "success": 2,
    "failed": 0,
    "results": [
      {
        "file_name": "2026_国债_01号公告.pdf",
        "status": "extracted",
        "extracted": {
          "bond_code": "240001",
          "bond_name": "2026年记账式附息（一期）国债",
          "issuer": "财政部",
          "bond_type": "国债",
          "issue_date": "2026-01-15",
          "issue_scale": 300.00,
          "term": "7Y",
          "bidding_method": "荷兰式",
          "is_reissue": false,
          "confidence": 0.94
        }
      }
    ]
  }
}
```

#### 2.2.2 查询招标日历
```http
GET /api/announcement/calendar
Authorization: Bearer <JWT>
```

**查询参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| start_date | date | 否 | 开始日期 |
| end_date | date | 否 | 结束日期 |
| bond_type | string | 否 | 国债/地方债/政金债/信用债 |
| status | string | 否 | 待确认/已确认/已忽略 |
| page | int | 否 | 页码，默认 1 |
| page_size | int | 否 | 默认 20 |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "total": 156,
    "page": 1,
    "page_size": 20,
    "items": [
      {
        "id": 1001,
        "bond_code": "240001",
        "bond_name": "2026年记账式附息（一期）国债",
        "issuer": "财政部",
        "bond_type": "国债",
        "issue_date": "2026-01-15",
        "issue_scale": 300.00,
        "term": "7Y",
        "bidding_method": "荷兰式",
        "status": "confirmed"
      }
    ]
  }
}
```

#### 2.2.3 确认/修正提取结果
```http
PUT /api/announcement/{id}
Authorization: Bearer <JWT>
Content-Type: application/json
```

**请求体：**
```json
{
  "bond_code": "240001",
  "bond_name": "2026年记账式附息（一期）国债",
  "issue_scale": 300.00,
  "status": "confirmed"
}
```

#### 2.2.4 数据库表设计
```sql
CREATE TABLE IF NOT EXISTS bond_announcements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  file_name VARCHAR(255),
  file_path TEXT,
  source VARCHAR(50),
  bond_code VARCHAR(50),
  bond_name VARCHAR(255),
  issuer VARCHAR(255),
  bond_type VARCHAR(50),
  issue_date DATE,
  issue_scale DECIMAL(18,4),
  term VARCHAR(20),
  bidding_method VARCHAR(50),
  benchmark_rate DECIMAL(10,4),
  basic_spread DECIMAL(10,4),
  is_reissue BOOLEAN DEFAULT FALSE,
  lead_underwriter VARCHAR(255),
  underwriters TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  confidence DECIMAL(3,2),
  extracted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 三、P0-2 跨文档财务勾稽核查

### 3.1 需求文档

#### 3.1.1 功能描述
用户上传一组债券申报材料（募集说明书、审计报告、评级报告、法律意见书等），系统自动抽取关键财务指标，并跨文档校验同一指标在不同文档中的取值是否一致，输出差异报告。

#### 3.1.2 输入
- 文档组名称（如"XX公司2026年企业债申报"）
- 多个文件：募集说明书、审计报告、评级报告、法律意见书等
- 文档类型标注（可选，系统自动识别）

#### 3.1.3 输出
- 抽取的指标列表
- 跨文档一致性比对结果
- 差异明细（字段、文档A值、文档B值、差异类型）
- 整体一致性评分

#### 3.1.4 关键财务指标清单
| 指标类别 | 指标名称 |
|----------|----------|
| 资产负债 | 总资产、总负债、资产负债率、净资产 |
| 盈利能力 | 营业收入、净利润、毛利率、净利率 |
| 现金流 | 经营活动现金流、投资活动现金流、筹资活动现金流 |
| 偿债能力 | 流动比率、速动比率、EBITDA、利息保障倍数 |
| 债券相关 | 存量债券余额、本次发行规模、募集资金用途 |

#### 3.1.5 业务规则
1. 数值差异在 ±1% 以内视为一致。
2. 单位不一致时自动换算（亿元/万元/元）。
3. 某文档缺失该指标时，标记为"来源缺失"。
4. 差异按严重程度分级：🔴严重（>5% 或关键指标冲突）、🟠中等（1%-5%）、🟢轻微（<1%）。

#### 3.1.6 异常处理
- 文档解析失败：跳过该文档，其他文档继续核查。
- 关键指标全部缺失：提示用户检查文档质量。

---

### 3.2 接口设计

#### 3.2.1 创建核查任务
```http
POST /api/finance/check
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

**请求参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| task_name | string | 是 | 核查任务名称 |
| files | file[] | 是 | 申报材料，2-10 个 |
| doc_types | string[] | 否 | 文档类型，与 files 一一对应 |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "task_id": "FC-20260115-001",
    "status": "processing",
    "estimated_seconds": 30
  }
}
```

#### 3.2.2 查询核查结果
```http
GET /api/finance/check/{task_id}
Authorization: Bearer <JWT>
```

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "task_id": "FC-20260115-001",
    "task_name": "XX公司2026年企业债申报",
    "status": "completed",
    "consistency_score": 0.82,
    "documents": [
      {"type": "募集说明书", "file_name": "募集说明书.pdf"},
      {"type": "审计报告", "file_name": "审计报告.pdf"}
    ],
    "indicators": [
      {
        "indicator": "总资产",
        "unit": "亿元",
        "values": {
          "募集说明书": 1250.50,
          "审计报告": 1250.50,
          "评级报告": 1248.00
        },
        "status": "一致"
      },
      {
        "indicator": "净利润",
        "unit": "亿元",
        "values": {
          "募集说明书": 45.80,
          "审计报告": 43.20,
          "评级报告": null
        },
        "status": "严重差异",
        "diff_rate": 0.0568,
        "severity": "high"
      }
    ]
  }
}
```

#### 3.2.3 获取核查报告 PDF
```http
GET /api/finance/check/{task_id}/report
Authorization: Bearer <JWT>
```

返回 PDF 文件流或下载链接。

#### 3.2.4 数据库表设计
```sql
CREATE TABLE IF NOT EXISTS finance_check_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  task_id VARCHAR(50) UNIQUE,
  task_name VARCHAR(255),
  status VARCHAR(50) DEFAULT 'processing',
  consistency_score DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_check_documents (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(50) REFERENCES finance_check_tasks(task_id),
  doc_type VARCHAR(50),
  file_name VARCHAR(255),
  file_path TEXT
);

CREATE TABLE IF NOT EXISTS finance_check_results (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(50) REFERENCES finance_check_tasks(task_id),
  indicator VARCHAR(100),
  unit VARCHAR(20),
  doc_values JSONB,
  status VARCHAR(50),
  diff_rate DECIMAL(10,4),
  severity VARCHAR(20)
);
```

---

## 四、P0-3 负面清单/合规红线初审

### 4.1 需求文档

#### 4.1.1 功能描述
将监管规则、历史问题清单、指导意见导入知识库，AI 自动扫描债券申报材料，识别是否存在触碰负面清单或合规红线的问题，并给出对应条款依据。

#### 4.1.2 输入
- 待审核文件：募集说明书、募集说明书摘要等
- 债券类型：企业债/公司债/中期票据/短融等
- 审核规则集（可选，默认全部）

#### 4.1.3 输出
- 风险点列表
- 每条风险点的风险等级、对应条款、原文引用、修改建议
- 总体合规评分

#### 4.1.4 审核规则分类
| 规则类别 | 示例 |
|----------|------|
| 地方政府债务 | 是否存在新增地方政府隐性债务 |
| 募集资金用途 | 是否用于非经营性项目、房地产、股市等禁止领域 |
| 信息披露 | 重大诉讼、对外担保、关联交易是否充分披露 |
| 发行条件 | 净利润、资产负债率、债券余额是否满足发行条件 |
| 历史违规 | 发行人近三年内是否存在重大违法违规 |

#### 4.1.5 业务规则
1. 每条风险点必须给出原文引用和对应监管条款。
2. 风险等级：🔴严重（必须修改）、🟠高危（建议修改）、🟡中危（关注）、🟢建议（优化）。
3. 严重问题数量 > 0 时，总体结论为"不通过"。
4. 支持按债券类型加载不同规则集。

---

### 4.2 接口设计

#### 4.2.1 上传规则文件
```http
POST /api/compliance/rules
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

**请求参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| files | file[] | 是 | 监管规则文件 |
| bond_type | string | 是 | 适用券种 |
| effective_date | date | 否 | 规则生效日期 |

#### 4.2.2 执行合规初审
```http
POST /api/compliance/check
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

**请求参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| files | file[] | 是 | 待审核材料 |
| bond_type | string | 是 | 企业债/公司债/中票/短融等 |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "task_id": "CP-20260115-001",
    "status": "completed",
    "overall_score": 72,
    "conclusion": "存在严重问题，需修改",
    "risks": [
      {
        "id": "R001",
        "level": "high",
        "category": "募集资金用途",
        "description": "募集资金拟用于偿还公司存量银行贷款，但申报材料中未充分说明贷款用途与本期债券募投项目的关联性。",
        "source_text": "本期债券募集资金 10 亿元，拟用于偿还公司存量银行贷款。",
        "rule_reference": "《公司债券发行与交易管理办法》第十五条",
        "suggestion": "补充说明偿还贷款的具体明细、原贷款用途，以及是否符合债券募集资金用途规定。"
      }
    ]
  }
}
```

#### 4.2.3 查询规则库
```http
GET /api/compliance/rules
Authorization: Bearer <JWT>
```

**查询参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| bond_type | string | 否 | 按券种筛选 |
| keyword | string | 否 | 按关键词搜索 |

#### 4.2.4 数据库表设计
```sql
CREATE TABLE IF NOT EXISTS compliance_rules (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  bond_type VARCHAR(50),
  rule_category VARCHAR(100),
  rule_title VARCHAR(255),
  rule_content TEXT,
  reference VARCHAR(255),
  effective_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compliance_check_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  task_id VARCHAR(50) UNIQUE,
  bond_type VARCHAR(50),
  overall_score INTEGER,
  conclusion VARCHAR(100),
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS compliance_check_risks (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(50) REFERENCES compliance_check_tasks(task_id),
  level VARCHAR(20),
  category VARCHAR(100),
  description TEXT,
  source_text TEXT,
  rule_reference VARCHAR(255),
  suggestion TEXT
);
```

---

## 五、P0-4 地方债合规预检

### 5.1 需求文档

#### 5.1.1 功能描述
针对地方政府专项债项目申报材料（项目申报书、可行性研究报告），AI 自动审查项目公益性、收益覆盖倍数、资金投向合规性等关键要素，输出地方债合规预检报告。

#### 5.1.2 输入
- 项目申报书（PDF/Word）
- 可行性研究报告（PDF/Word）
- 项目类型：交通/产业园/水利/棚改等（可选）

#### 5.1.3 输出
- 项目基本信息
- 合规检查清单及结果
- 收益覆盖测算
- 总体结论：通过 / 有条件通过 / 不通过

#### 5.1.4 检查清单
| 检查项 | 标准 |
|--------|------|
| 项目公益性 | 必须属于有一定收益的公益性项目 |
| 收益覆盖倍数 | 项目收益/本息 ≥ 1.2 倍（部分省份要求 1.3 倍） |
| 资金投向合规 | 不得用于商业地产、楼堂馆所、形象工程等 |
| 项目成熟度 | 已完成立项、用地、环评等前期手续 |
| 还款来源 | 还款来源明确、可持续，不得过度依赖土地出让收入 |

#### 5.1.5 业务规则
1. 任一检查项为"不通过"，总体结论为"不通过"。
2. 收益覆盖倍数在 1.0-1.2 之间，标记为"有风险，需补充论证"。
3. 输出中必须引用政策文件依据。

---

### 5.2 接口设计

#### 5.2.1 执行地方债合规预检
```http
POST /api/local-bond/check
Authorization: Bearer <JWT>
Content-Type: multipart/form-data
```

**请求参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| project_name | string | 是 | 项目名称 |
| project_type | string | 否 | 项目类型 |
| files | file[] | 是 | 申报书、可研报告等 |

**响应示例：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "task_id": "LB-20260115-001",
    "project_name": "XX市轨道交通3号线项目",
    "project_type": "交通",
    "status": "completed",
    "conclusion": "有条件通过",
    "score": 78,
    "checks": [
      {
        "item": "项目公益性",
        "result": "通过",
        "evidence": "项目属于城市轨道交通，符合公益性项目范围。",
        "reference": "财预〔2017〕89号"
      },
      {
        "item": "收益覆盖倍数",
        "result": "有风险",
        "evidence": "测算收益覆盖倍数为 1.15 倍，低于 1.2 倍常规要求。",
        "suggestion": "补充票务收入、沿线土地综合开发收益等论证材料。"
      }
    ]
  }
}
```

#### 5.2.2 查询地方债预检历史
```http
GET /api/local-bond/check
Authorization: Bearer <JWT>
```

**查询参数：**
| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| project_name | string | 否 | 项目名称模糊查询 |
| conclusion | string | 否 | 通过/有条件通过/不通过 |
| page | int | 否 | 默认 1 |
| page_size | int | 否 | 默认 20 |

#### 5.2.3 数据库表设计
```sql
CREATE TABLE IF NOT EXISTS local_bond_check_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  task_id VARCHAR(50) UNIQUE,
  project_name VARCHAR(255),
  project_type VARCHAR(50),
  conclusion VARCHAR(50),
  score INTEGER,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS local_bond_check_items (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(50) REFERENCES local_bond_check_tasks(task_id),
  item_name VARCHAR(100),
  result VARCHAR(50),
  evidence TEXT,
  reference VARCHAR(255),
  suggestion TEXT
);
```

---

## 六、公共能力与扩展设计

### 6.1 新增数据表汇总
除各功能自身表格外，建议补充以下公共表：

```sql
-- 文件上传记录表
CREATE TABLE IF NOT EXISTS uploaded_files (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  task_type VARCHAR(50),
  task_id VARCHAR(50),
  file_name VARCHAR(255),
  file_path TEXT,
  file_size BIGINT,
  mime_type VARCHAR(100),
  extracted_text TEXT,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 任务队列表（用于异步处理）
CREATE TABLE IF NOT EXISTS ai_tasks (
  id SERIAL PRIMARY KEY,
  task_id VARCHAR(50) UNIQUE,
  user_id INTEGER REFERENCES users(id),
  task_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  result JSONB,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);
```

### 6.2 异步处理机制
- 跨文档核查、合规初审、地方债预检等耗时操作采用异步任务队列。
- 用户提交后立即返回 `task_id` 和 `estimated_seconds`。
- 前端通过轮询 `GET /api/tasks/{task_id}` 获取进度。

### 6.3 AI 模型调用策略
| 功能 | 主要模型能力 | 建议模型 |
|------|--------------|----------|
| 公告结构化 | OCR + 信息抽取 | DeepSeek / Kimi + 本地 OCR |
| 财务勾稽 | 表格解析 + 数值比对 | DeepSeek / Kimi |
| 合规初审 | RAG + 条款匹配 | DeepSeek / Kimi + 规则引擎 |
| 地方债预检 | RAG + 清单校验 | DeepSeek / Kimi + 规则引擎 |

### 6.4 安全与审计
1. 所有上传文件保留原始副本和提取文本，便于审计。
2. AI 输出必须标注"仅供参考，最终以人工审核为准"。
3. 涉及写库操作（如 Text-to-SQL）需增加人工确认环节。
4. 敏感数据不出内网，模型调用走私有化部署或可信通道。

---

## 七、实施优先级建议

| 阶段 | 功能 | 预计工期 | 依赖 |
|------|------|----------|------|
| 第 1 周 | 招标公告结构化提取 | 5 天 | OCR、文件解析 |
| 第 2-3 周 | 跨文档财务勾稽核查 | 10 天 | 表格抽取、指标对齐 |
| 第 4 周 | 负面清单/合规红线初审 | 7 天 | 规则库建设 |
| 第 5-6 周 | 地方债合规预检 | 10 天 | 政策文件整理 |

---

## 八、结语

以上 P0 功能点均可在 `ccdc-ai-service` 现有架构上快速实现，核心依赖是：
1. 扩展文件解析能力（表格、PDF 版式识别）
2. 建设领域知识库（监管规则、政策文件）
3. 引入规则引擎补充 LLM 的判断
4. 增加异步任务处理机制

建议优先启动**招标公告结构化提取**和**跨文档财务勾稽核查**，两者技术成熟度高、业务痛点明确，可在 2-3 周内产出可用版本。
