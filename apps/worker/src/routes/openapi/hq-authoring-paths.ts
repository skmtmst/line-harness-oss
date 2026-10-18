// Definitions only. Runtime handlers remain in their feature routes.
export const hqAuthoringPaths = {

  // V8 API integration: authenticated endpoints, with account scope and revision checks.
  '/api/hq/templates/saved-views': {
  get: {tags:['HQ Templates'],summary:'統括テンプレートの保存した絞り込みを取得',responses:{200:{description:'個人と統括で共有された条件'},403:{description:'統括の閲覧権限が必要'}}},
  post: {tags:['HQ Templates'],summary:'テンプレートの絞り込みを保存',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['name','filters'],properties:{name:{type:'string',maxLength:100},scope:{type:'string',enum:['personal','tenant'],default:'personal'},filters:{type:'object',description:'kind・messageCount・hasInterpolations・undistributed・search・folderIdだけを許可'}}}}}},responses:{201:{description:'保存済みの条件とrevision'},403:{description:'統括の編集権限が必要'},422:{description:'条件または分類が不正'}}},
  },
  '/api/hq/templates/saved-views/{viewId}': {
  patch:{parameters:[{name:'viewId',in:'path',required:true,schema:{type:'string'}}],tags:['HQ Templates'],summary:'保存した絞り込みを変更',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['name','filters','expectedRevision'],properties:{name:{type:'string',maxLength:100},filters:{type:'object'},scope:{type:'string',enum:['personal','tenant']},expectedRevision:{type:'integer',minimum:1}}}}}},responses:{200:{description:'更新後のrevisionと条件'},403:{description:'統括の編集権限が必要'},404:{description:'見える条件がありません'},409:{description:'版が変更されました'},422:{description:'入力が不正'}}},
  delete:{parameters:[{name:'viewId',in:'path',required:true,schema:{type:'string'}}],tags:['HQ Templates'],summary:'保存した絞り込みを保管',requestBody:{required:true,content:{'application/json':{schema:{type:'object',required:['expectedRevision'],properties:{expectedRevision:{type:'integer',minimum:1}}}}}},responses:{200:{description:'保管済み'},403:{description:'統括の編集権限が必要'},404:{description:'見える条件がありません'},409:{description:'版が変更されました'}}},
  },
  "/api/hq/templates/folders": {
  "get": {
    "tags": [
      "HQ Templates"
    ],
    "summary": "統括ひな形の分類一覧を取得",
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
    }
  },
  "post": {
    "tags": [
      "HQ Templates"
    ],
    "summary": "統括ひな形の分類を追加",
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
              "name": {
                "type": "string"
              }
            },
            "required": [
              "name"
            ]
          }
        }
      }
    }
  }
  },
  "/api/hq/templates/folders/{id}": {
  "patch": {
    "tags": [
      "HQ Templates"
    ],
    "summary": "確認した版で分類名を変更",
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
              "name": {
                "type": "string"
              },
              "expectedRevision": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "name",
              "expectedRevision"
            ]
          }
        }
      }
    }
  },
  "delete": {
    "tags": [
      "HQ Templates"
    ],
    "summary": "分類を外し、ひな形は未分類に残す",
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
              "expectedRevision": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "expectedRevision"
            ]
          }
        }
      }
    }
  }
  },
  "/api/hq/templates/{id}/duplicate": {
  "post": {
    "tags": [
      "HQ Templates"
    ],
    "summary": "確認した版からひな形のコピーを作る",
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
              "name": {
                "type": "string"
              },
              "expectedRevision": {
                "type": "integer",
                "minimum": 1
              },
              "requestId": {
                "type": "string"
              }
            },
            "required": [
              "name",
              "expectedRevision",
              "requestId"
            ]
          }
        }
      }
    }
  }
  },
};
