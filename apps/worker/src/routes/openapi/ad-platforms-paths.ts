// Definitions only. Runtime handlers remain in their feature routes.
export const adPlatformsPaths = {
  "/api/ad-platforms/mappings": {
  "get": {
    "tags": [
      "Conversions"
    ],
    "summary": "成果地点と広告媒体の名前の対応一覧",
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
    }
  }
  },
  "/api/ad-platforms/mappings/{pointId}": {
  "put": {
    "tags": [
      "Conversions"
    ],
    "summary": "広告へ返す成果名の自動対応・手動指定・停止を保存",
    "parameters": [
      {
        "name": "pointId",
        "in": "path",
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
              "account_id": {
                "type": "string"
              },
              "provider": {
                "type": "string",
                "enum": [
                  "meta",
                  "google"
                ]
              },
              "mode": {
                "type": "string",
                "enum": [
                  "auto",
                  "manual",
                  "off"
                ]
              },
              "eventName": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "googleActionId": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "expectedVersion": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "account_id",
              "provider",
              "mode",
              "expectedVersion"
            ]
          }
        }
      }
    }
  }
  },
  "/api/ad-platforms/{id}/connect": {
  "post": {
    "tags": [
      "Conversions"
    ],
    "summary": "保存した広告連携設定の読み取り接続を検査",
    "parameters": [
      {
        "name": "id",
        "in": "path",
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
    }
  }
  },
};
