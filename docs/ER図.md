# ER図

DBの表と関係を図にしたものです。定義の正本は`prisma/schema.prisma`と`prisma/migrations`の移行SQLで、各表の内容は[仕様書の「8. データモデル」](仕様書.md#8-データモデル)にあります。表や関係を変えたら、この図も直してください。

- 図はMermaidで書いています。GitHubやVS Code（Mermaid対応の拡張機能）でそのまま図として表示されます。
- 項目は主キー・外部キー・一意項目と、関係を読むのに必要なものだけを載せています。`createdAt`、`updatedAt`、`version`（楽観的ロック）などは省いています。
- 線の記号は、`||`が「必ず1」、`|o`が「0か1」、`o{`が「0以上」を表します。

## 1. 社員・車両・駐車場・利用

```mermaid
erDiagram
    EmployeeNumber ||--o{ Employee : "番号を使う"
    Department ||--o{ Employee : "所属"
    VehicleNumber ||--o{ Vehicle : "番号を使う"

    Employee ||--o{ Trip : "利用・予約"
    Vehicle ||--o{ Trip : "利用・予約"
    Vehicle ||--o{ VehicleMaintenance : "車検・整備"

    ParkingSpot |o--o| Vehicle : "駐車中"
    Vehicle |o--o{ ParkingSpot : "専用区画"
    ParkingSpot ||--o{ ParkingSpotFront : "奥の区画"
    ParkingSpot ||--o{ ParkingSpotFront : "手前の区画"

    NfcTag ||--o{ NfcAssignment : "割り当て"
    Employee |o--o{ NfcAssignment : "社員のタグ"
    Vehicle |o--o{ NfcAssignment : "車両のタグ"

    Employee |o--o{ AuditLog : "操作した人"

    EmployeeNumber {
        String id PK
        String code UK "A001の形"
    }
    Department {
        String id PK
        String name UK
        Int sortOrder
        Boolean active
    }
    Employee {
        String id PK
        String employeeNumberId FK
        String departmentId FK
        String name
        String email UK "任意"
        String qrToken UK "QR用・不変"
        Boolean active
    }
    VehicleNumber {
        String id PK
        String code UK "A001の形"
    }
    Vehicle {
        String id PK
        String vehicleNumberId FK
        String parkingSpotId FK,UK "今停めている区画"
        String name
        String plateNumber UK
        String qrToken UK "QR用・不変"
        VehicleStatus status
        Int fuelLevel "0から4、未登録はnull"
        Boolean active
    }
    ParkingSpot {
        String id PK
        String code UK
        ParkingSpotRole role
        ParkingVehicleClass vehicleClass "指定なし・普通車用・軽自動車用"
        String dedicatedVehicleId FK "role=DEDICATEDのときだけ"
        ParkingSpotOrientation orientation
        Float x
        Float y
        Boolean enabled
    }
    ParkingSpotFront {
        String spotId PK,FK "出し入れする区画"
        String frontSpotId PK,FK "その手前の区画"
    }
    Trip {
        String id PK
        String employeeId FK
        String vehicleId FK
        TripStatus status
        DateTime plannedStart
        DateTime plannedEnd
        DateTime actualStart
        DateTime actualEnd
        String returnSpotCode "返却した区画"
        DateTime snapshotCapturedAt "開始時点の写しを取った日時"
    }
    VehicleMaintenance {
        String id PK
        String vehicleId FK
        MaintenanceKind kind
        MaintenanceStatus status
        DateTime plannedStart
        DateTime plannedEnd "未定はnull"
        DateTime actualStart
        DateTime actualEnd
    }
    NfcTag {
        String id PK
        String uid UK
    }
    NfcAssignment {
        String id PK
        String nfcTagId FK
        String employeeId FK "社員か車両のどちらか一方"
        String vehicleId FK "社員か車両のどちらか一方"
        DateTime validFrom
        DateTime validTo "外したら日時が入る"
        Boolean cleared
    }
    AuditLog {
        String id PK
        String operationId UK "二重送信防止"
        String actorEmployeeId FK "社員を消したらnull"
        String actorName
        String action
        String targetType
        String targetId
        DateTime createdAt
    }
```

## 2. 案内・お礼の設定と音声

ほかの表とはつながっていない、設定だけの表です。音声は`NoticeAudio`にまとめ、各設定から1件ずつ参照します。

```mermaid
erDiagram
    NoticeAudio |o--o| FuelStartNotice : "音声"
    NoticeAudio |o--o| FuelReturnNotice : "音声"
    NoticeAudio |o--o| FuelThankYouSetting : "音声"
    NoticeAudio |o--o| ParkingGuidanceSetting : "音声"

    NoticeAudio {
        String id PK
        Bytes data "2MBまで"
        String mime "audio/mpegかaudio/wav"
        String name
    }
    FuelStartNotice {
        Int level PK "残量0から4"
        String audioId FK,UK
        String displayMode
        Boolean enabled
        String message
    }
    FuelReturnNotice {
        Int level PK "残量0から4"
        String audioId FK,UK
        String displayMode
        Boolean enabled
        String message
    }
    FuelThankYouSetting {
        String id PK "default の1行だけ"
        String audioId FK,UK
        Boolean enabled
        String message
    }
    ParkingGuidanceSetting {
        String event PK "案内の種類"
        String audioId FK,UK
        Boolean enabled
        String message
    }
```

## 3. 図に表れない制約

関係の読み方に効く制約です。移行SQLのCHECK制約・部分一意索引で守っています。

| 対象 | 制約 |
| --- | --- |
| `Vehicle.parkingSpotId` | 一意。1区画に停められる車は1台 |
| `ParkingSpot.dedicatedVehicleId` | `role`が`DEDICATED`のときだけ値が入り、それ以外はnull |
| `ParkingSpot.vehicleClass` | `ANY`（指定なし）・`STANDARD`（普通車用）・`KEI`（軽自動車用）。専用区画の制限とは別の推奨値 |
| `ParkingSpotFront` | 自分自身を手前の区画にできない。区画を消すと一緒に消える |
| `NfcAssignment` | `employeeId`と`vehicleId`はどちらか一方だけに値が入る。有効な割り当て（`validTo`がnull）は、タグ・社員・車両ごとに1件まで |
| `Employee`、`Vehicle` | 有効なもの（`active`がtrue）の中で、同じ社員番号・車両番号は1件まで |
| `Trip` | 利用中（`IN_USE`）は車両ごと・社員ごとに1件まで。状態と実績日時の組み合わせが合っていること |
| `VehicleMaintenance` | 整備中（`ACTIVE`）は車両ごとに1件まで |
| `AuditLog` | 社員を消しても履歴は残し、`actorEmployeeId`をnullにする。名前は`actorName`に残る |
| 各案内の`audioId` | 一意。音声を消すと参照はnullになる |
