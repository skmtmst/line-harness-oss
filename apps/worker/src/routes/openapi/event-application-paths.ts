// Definitions only. Runtime handlers remain in their feature routes.
export const eventApplicationPaths = {
  "/api/events/admin/application-preview": {
  "post": {
    "tags": [
      "Events"
    ],
    "summary": "保存せずにイベント申込ページの見本を取得",
    "parameters": [
      {
        "name": "account_id",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string"
        }
      }
    ],
    "responses": {
      "200": {
        "description": "成功",
        "content": {
          "application/json": {
            "schema": {
              "$ref": "#/components/schemas/ApiResponse"
            }
          }
        }
      },
      "403": {
        "description": "権限がありません"
      },
      "409": {
        "description": "確認した版や対象が変わりました"
      },
      "422": {
        "description": "入力を確認してください"
      }
    },
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string"
              },
              "description": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "venue_name": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "venue_address": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "venue_url": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "requires_approval": {
                "type": "integer",
                "enum": [0, 1]
              },
              "slot": {
                "type": "object",
                "properties": {
                  "starts_at": {
                    "type": "string"
                  },
                  "ends_at": {
                    "type": "string"
                  },
                  "capacity": {
                    "type": "integer",
                    "minimum": 1
                  }
                },
                "required": [
                  "starts_at",
                  "ends_at",
                  "capacity"
                ]
              }
            },
            "required": [
              "name",
              "slot"
            ]
          }
        }
      }
    }
  }
  },
};
