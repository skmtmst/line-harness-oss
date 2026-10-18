// Definitions only. Runtime handlers remain in their feature routes.
export const photoPublicationsPaths = {
  "/api/nen-members/photos/publications/order": {
  "get": {
    "tags": [
      "NEN delivery"
    ],
    "summary": "掲載順の全件と現在の版を取得",
    "parameters": [
      {
        "name": "accountId",
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
  },
  "put": {
    "tags": [
      "NEN delivery"
    ],
    "summary": "掲載順の全件と確認した版を一度に保存",
    "parameters": [],
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
              "accountId": {
                "type": "string"
              },
              "items": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "expectedVersion": {
                      "type": "integer",
                      "minimum": 1
                    }
                  },
                  "required": [
                    "id",
                    "expectedVersion"
                  ]
                }
              }
            },
            "required": [
              "accountId",
              "items"
            ]
          }
        }
      }
    }
  }
  },
  "/api/nen-members/photos/{id}/publish": {
  "post": {
    "tags": [
      "NEN delivery"
    ],
    "summary": "同意済み採用写真を掲載し、追加報酬を一度だけ手続きする",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string"
        }
      },
      {
        "name": "Idempotency-Key",
        "in": "header",
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
              "accountId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer",
                "minimum": 0
              }
            },
            "required": [
              "accountId",
              "expectedVersion"
            ]
          }
        }
      }
    }
  }
  },
};
