// Definitions only. Runtime handlers remain in their feature routes.
export const notificationTeamsPaths = {
  "/api/notifications/teams": {
  "get": {
    "tags": [
      "Operator notifications"
    ],
    "summary": "運用者通知の送り先チーム一覧を取得",
    "parameters": [
      {
        "name": "lineAccountId",
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
  "post": {
    "tags": [
      "Operator notifications"
    ],
    "summary": "担当範囲内のスタッフで送り先チームを作る",
    "parameters": [],
    "responses": {
      "201": {
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
              "lineAccountId": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "staffIds": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "expectedVersion": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "lineAccountId",
              "name",
              "staffIds"
            ]
          }
        }
      }
    }
  }
  },
  "/api/notifications/teams/{id}": {
  "put": {
    "tags": [
      "Operator notifications"
    ],
    "summary": "確認した版で送り先チームを変更",
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
    },
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "properties": {
              "lineAccountId": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "staffIds": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "expectedVersion": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "lineAccountId",
              "name",
              "staffIds",
              "expectedVersion"
            ]
          }
        }
      }
    }
  },
  "delete": {
    "tags": [
      "Operator notifications"
    ],
    "summary": "送り先チームを保管する",
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
    },
    "requestBody": {
      "required": true,
      "content": {
        "application/json": {
          "schema": {
            "type": "object",
            "properties": {
              "lineAccountId": {
                "type": "string"
              },
              "expectedVersion": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "lineAccountId",
              "expectedVersion"
            ]
          }
        }
      }
    }
  }
  },
};
