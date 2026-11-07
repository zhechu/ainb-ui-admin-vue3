import { Layout } from '@/utils/routerHelper'

const { t } = useI18n()
/**
 * redirect: noredirect        当设置 noredirect 的时候该路由在面包屑导航中不可被点击
 * name:'router-name'          设定路由的名字，一定要填写不然使用<keep-alive>时会出现各种问题
 * meta : {
 hidden: true              当设置 true 的时候该路由不会再侧边栏出现 如404，login等页面(默认 false)

 alwaysShow: true          当你一个路由下面的 children 声明的路由大于1个时，自动会变成嵌套的模式，
 只有一个时，会将那个子路由当做根路由显示在侧边栏，
 若你想不管路由下面的 children 声明的个数都显示你的根路由，
 你可以设置 alwaysShow: true，这样它就会忽略之前定义的规则，
 一直显示根路由(默认 false)

 title: 'title'            设置该路由在侧边栏和面包屑中展示的名字

 icon: 'svg-name'          设置该路由的图标

 noCache: true             如果设置为true，则不会被 <keep-alive> 缓存(默认 false)

 breadcrumb: false         如果设置为false，则不会在breadcrumb面包屑中显示(默认 true)

 affix: true               如果设置为true，则会一直固定在tag项中(默认 false)

 noTagsView: true          如果设置为true，则不会出现在tag中(默认 false)

 activeMenu: '/dashboard'  显示高亮的路由路径

 followAuth: '/dashboard'  跟随哪个路由进行权限过滤

 canTo: true               设置为true即使hidden为true，也依然可以进行路由跳转(默认 false)
 }
 **/
const remainingRouter: AppRouteRecordRaw[] = [
  {
    path: '/redirect',
    component: Layout,
    name: 'RedirectRoot',
    children: [
      {
        path: '/redirect/:path(.*)',
        name: 'Redirect',
        component: () => import('@/views/Redirect/Redirect.vue'),
        meta: {}
      }
    ],
    meta: {
      hidden: true,
      noTagsView: true
    }
  },
  {
    path: '/',
    component: Layout,
    redirect: '/index',
    name: 'Home',
    meta: {},
    children: [
      {
        path: 'index',
        component: () => import('@/views/Home/Index.vue'),
        name: 'Index',
        meta: {
          title: t('router.home'),
          icon: 'ep:home-filled',
          noCache: false,
          affix: true
        }
      }
    ]
  },
  {
    path: '/user',
    component: Layout,
    name: 'UserInfo',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'profile',
        component: () => import('@/views/Profile/Index.vue'),
        name: 'Profile',
        meta: {
          canTo: true,
          hidden: true,
          noTagsView: false,
          icon: 'ep:user',
          title: t('common.profile')
        }
      },
      {
        path: 'notify-message',
        component: () => import('@/views/system/notify/my/index.vue'),
        name: 'MyNotifyMessage',
        meta: {
          canTo: true,
          hidden: true,
          noTagsView: false,
          icon: 'ep:message',
          title: '我的站内信'
        }
      }
    ]
  },
  {
    path: '/infra-form-design',
    component: Layout,
    name: 'InfraFormDesignRuntime',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'preview',
        component: () => import('@/views/infra/formDesign/render/index.vue'),
        name: 'InfraFormDesignPreview',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '表单预览',
          // 表单设计菜单已归入「在线开发」目录，列表页完整路径由 /infra/form-design/list 变为 /infra/online/list
          activeMenu: '/infra/online/list'
        }
      }
    ]
  },
  {
    path: '/infra-portal',
    component: Layout,
    name: 'InfraPortalCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'portal/editor',
        component: () => import('@/views/infra/portal/editor/index.vue'),
        name: 'InfraPortalEditor',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '门户设计器',
          // 门户设计菜单已归入「在线开发」目录，完整路径由 /infra/portal 变为 /infra/online/portal
          activeMenu: '/infra/online/portal'
        }
      }
    ]
  },
  {
    path: '/agent-workflow',
    component: Layout,
    name: 'AgentWorkflowCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'editor',
        component: () => import('@/views/agent/workflow/editor/index.vue'),
        name: 'AgentWorkflowEditor',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '流程编排设计器',
          // 「流程编排」菜单在 /ai/agent/workflow（DB 菜单驱动，2026-09-29 起挂在「AI」下），设计器是它的隐藏整页子页
          activeMenu: '/ai/agent/workflow'
        }
      }
    ]
  },
  {
    path: '/agent-def',
    component: Layout,
    name: 'AgentDefCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'editor',
        component: () => import('@/views/agent/def/editor/index.vue'),
        name: 'AgentDefEditor',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '智能体设计器',
          // 「智能体管理」菜单在 /ai/agent/def（DB 菜单驱动，2026-09-29 起挂在「AI」下），设计器是它的隐藏整页子页
          activeMenu: '/ai/agent/def'
        }
      }
    ]
  },
  {
    // 🔴 这一页**不能**建成 DB 菜单，原因写在下面那条 meta 注释里
    path: '/qlzg-case',
    component: Layout,
    name: 'QlzgCaseRecallCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'recall',
        component: () => import('@/views/qlzg/case/recall/index.vue'),
        name: 'QlzgCaseRecall',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '案例召回',
          // 从标的台账那一行的「召回」进来，所以高亮标的台账
          activeMenu: '/qlzg/subject'
          //
          // 🔴 为什么走 remaining.ts 而不是建菜单（I3-g-5 实测踩到的）
          //
          // 非超管的导航集合是 `GrantDecisionService#listAllowedMenuIdsInternal` 从
          // **sys_resource 反查 menu_id** 得来的，再用 `completeMenuAncestors` 沿
          // system_menu 的父链**向上**补全祖先。于是：一个既没有 permission、
          // 又没有按钮子菜单的页面菜单，没有任何资源行指向它 ⟹ 永远进不了那个集合
          // ⟹ 前端不会为它注册路由 ⟹ 点「召回」落到 404，全程 200、无一条报错。
          //
          // 超管走的是 `menuMapper.selectList()` 全量，所以这个洞**只有非超管能撞见**，
          // 而 I2-g 的端到端验证是用 admin 跑的 ⟹ 当时全绿。
          //
          // ⚠️ 不要试图给它挂一个 `qlzg:case:query` 的按钮子菜单来「补上权限点」：
          // 塌缩后整个 `qlzg:case` 族只有**一行** sys_resource、只有**一个** menu_id，
          // 而案例台账与案例召回是**兄弟**、不在彼此的父链上 ——
          // 承载行指向谁，另一个就从导航里消失。两个兄弟页面不可能共用一个权限族。
          //
          // 判据（本仓所有 qlzg 隐藏页都照它办）：
          // **页面自己带权限点（或有按钮子菜单）⟹ 建菜单；一个都不带 ⟹ 写在这里。**
          // 「测算」带 qlzg:calculation:{query,create} + qlzg:param-snapshot:update，
          // 「结果确定」带 qlzg:calc-result:{query,create}，所以那两页是菜单；
          // 召回页唯一的接口 `/qlzg/case/recall-preview` 属于案例台账已经持有的那个族，
          // 所以它是这条静态路由。
        }
      }
    ]
  },
  {
    // 🔴 报告作业台与模板设计器都走这里，理由与上面那条召回页**同一条**：
    //    它们各自与自己的台账是**兄弟**、共用一个权限族
    //    （`qlzg:report` / `qlzg:template`），而塌缩之后整个族只有**一行**
    //    sys_resource、只有**一个** menu_id —— 承载行指向谁，
    //    另一个就从非超管的导航集合里消失，点进去落到 404（而本仓 404 的
    //    HTTP 状态码是 200，浏览器控制台与后端日志都干净）。
    //    台账带按钮子菜单，所以台账当菜单，这两个详情页是静态路由。
    path: '/qlzg-report',
    component: Layout,
    name: 'QlzgReportCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'workbench',
        component: () => import('@/views/qlzg/report/ReportWorkbench.vue'),
        name: 'QlzgReportWorkbench',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '报告作业台',
          // 从报告台账那一行的「作业台」进来，所以高亮报告台账
          activeMenu: '/qlzg/report'
        }
      }
    ]
  },
  {
    // 🔴 复核工作台同样走这里，理由与上面那条报告作业台**同一条**，而且更硬一层：
    //    它的两个数据端点（/qlzg/review/run/latest 与 /workbench）是**「只要登录」**、
    //    刻意不挂 @PreAuthorize 的（挂上的表现是「黄条不出现」「点进去 403」，
    //    那正好是 §11.9.2.6 第 3 条要防的「关了就看不见」，只不过换成「没权限就看不见」）。
    //    于是这一页**一个权限点都不带** ⟹ 建成 DB 菜单的话，
    //    非超管的导航集合里永远没有它、路由压根不注册，敲 URL 落到 404
    //    （而本仓 404 的 HTTP 状态码是 200，浏览器控制台与后端日志都干净）。
    //    ⚠️ 也别为了给它一个路由而去造一个假的权限点 ——
    //    那会在授权树上多出一个谁也不知道是什么的勾，
    //    而且会与「只要登录」那个刻意决定直接矛盾
    path: '/qlzg-review',
    component: Layout,
    name: 'QlzgReviewCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'workbench',
        component: () => import('@/views/qlzg/review/workbench/index.vue'),
        name: 'QlzgReviewWorkbench',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '复核工作台',
          // 从报告作业台顶部那个按钮进来，所以高亮报告台账
          activeMenu: '/qlzg/report'
        }
      }
    ]
  },
  {
    path: '/qlzg-template',
    component: Layout,
    name: 'QlzgTemplateCenter',
    meta: {
      hidden: true
    },
    children: [
      {
        // 🔴 子路由写的是**绝对路径** `/qlzg/template-designer`，不是相对的 `designer`：
        //    `template/index.vue` 里 push 的就是那个字符串。vue-router 允许子路由用绝对路径
        //    （此时父的 path 只用来挂 Layout 与 name，不参与拼接），
        //    于是这一条的 URL 与台账 `/qlzg/template` 同前缀，读起来是一家人。
        //    ⚠️ 改成相对的 `designer` 就要同步改 push 那一行 ——
        //    只改一处的表现是点「设计」停在原地（vue-router 只在控制台 warn，界面不动）
        path: '/qlzg/template-designer',
        component: () => import('@/views/qlzg/template/TemplateDesigner.vue'),
        name: 'QlzgTemplateDesigner',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '报告模板设计器',
          activeMenu: '/qlzg/template'
        }
      }
    ]
  },
  {
    path: '/dict',
    component: Layout,
    name: 'dict',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'type/data/:dictType',
        // 字典数据已并入 /system/dict 的左树右表页面。这里保留路由并重定向，
        // 是为了让存量菜单、浏览器书签仍能落到正确的字典上，而不是撞到 404
        redirect: (to) => ({
          path: '/system/dict',
          query: { dictType: to.params.dictType as string }
        }),
        name: 'SystemDictData',
        meta: {
          title: '字典数据',
          noCache: true,
          hidden: true,
          canTo: true,
          icon: '',
          activeMenu: '/system/dict'
        }
      }
    ]
  },
  {
    path: '/system/role',
    component: Layout,
    name: 'SystemRoleGrantL',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'grant',
        component: () => import('@/views/system/role/grant/index.vue'),
        name: 'SystemRoleGrant',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          icon: 'ep:key',
          title: '资源授权',
          // 角色管理菜单挂在「系统管理 → 组织权限」目录下，实际访问路径带 org-permission 段
          activeMenu: '/system/org-permission/role'
        }
      },
      {
        path: 'member',
        component: () => import('@/views/system/role/member/index.vue'),
        name: 'SystemRoleMember',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          icon: 'ep:user',
          title: '成员配置',
          activeMenu: '/system/org-permission/role'
        }
      }
    ]
  },
  {
    path: '/codegen',
    component: Layout,
    name: 'CodegenEdit',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'edit',
        component: () => import('@/views/infra/codegen/EditTable.vue'),
        name: 'InfraCodegenEditTable',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          icon: 'ep:edit',
          title: '修改生成配置',
          activeMenu: 'infra/codegen/index'
        }
      }
    ]
  },
  {
    path: '/job',
    component: Layout,
    name: 'JobL',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'job-log',
        component: () => import('@/views/infra/job/logger/index.vue'),
        name: 'InfraJobLog',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          icon: 'ep:edit',
          title: '调度日志',
          activeMenu: 'infra/job/index'
        }
      }
    ]
  },
  {
    path: '/login',
    component: () => import('@/views/Login/Login.vue'),
    name: 'Login',
    meta: {
      hidden: true,
      title: t('router.login'),
      noTagsView: true
    }
  },
  {
    path: '/sso',
    component: () => import('@/views/Login/Login.vue'),
    name: 'SSOLogin',
    meta: {
      hidden: true,
      title: t('router.login'),
      noTagsView: true
    }
  },
  {
    path: '/social-login',
    component: () => import('@/views/Login/SocialLogin.vue'),
    name: 'SocialLogin',
    meta: {
      hidden: true,
      title: t('router.socialLogin'),
      noTagsView: true
    }
  },
  {
    path: '/403',
    component: () => import('@/views/Error/403.vue'),
    name: 'NoAccess',
    meta: {
      hidden: true,
      title: '403',
      noTagsView: true
    }
  },
  {
    path: '/404',
    component: () => import('@/views/Error/404.vue'),
    name: 'NoFound',
    meta: {
      hidden: true,
      title: '404',
      noTagsView: true
    }
  },
  {
    path: '/500',
    component: () => import('@/views/Error/500.vue'),
    name: 'Error',
    meta: {
      hidden: true,
      title: '500',
      noTagsView: true
    }
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/Error/404.vue'),
    name: '',
    meta: {
      title: '404',
      hidden: true,
      breadcrumb: false
    }
  },
  {
    path: '/bpm',
    component: Layout,
    name: 'bpm',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'manager/form/edit',
        component: () => import('@/views/bpm/form/editor/index.vue'),
        name: 'BpmFormEditor',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '设计流程表单',
          activeMenu: '/bpm/manager/form'
        }
      },
      {
        path: 'manager/definition',
        component: () => import('@/views/bpm/model/definition/index.vue'),
        name: 'BpmProcessDefinition',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '流程定义',
          activeMenu: '/bpm/manager/model'
        }
      },
      {
        path: 'process-instance/detail',
        component: () => import('@/views/bpm/processInstance/detail/index.vue'),
        name: 'BpmProcessInstanceDetail',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '流程详情',
          activeMenu: '/bpm/task/my'
        },
        props: (route) => ({
          id: route.query.id,
          taskId: route.query.taskId,
          activityId: route.query.activityId
        })
      },
      {
        path: 'process-instance/report',
        component: () => import('@/views/bpm/processInstance/report/index.vue'),
        name: 'BpmProcessInstanceReport',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '数据报表',
          activeMenu: '/bpm/manager/model'
        }
      },
      {
        path: 'oa/leave/create',
        component: () => import('@/views/bpm/oa/leave/create.vue'),
        name: 'OALeaveCreate',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '发起 OA 请假',
          activeMenu: '/bpm/oa/leave'
        }
      },
      {
        path: 'oa/leave/detail',
        component: () => import('@/views/bpm/oa/leave/detail.vue'),
        name: 'OALeaveDetail',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '查看 OA 请假',
          activeMenu: '/bpm/oa/leave'
        }
      },
      {
        path: 'manager/model/create',
        component: () => import('@/views/bpm/model/form/index.vue'),
        name: 'BpmModelCreate',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '创建流程',
          activeMenu: '/bpm/manager/model'
        }
      },
      {
        path: 'manager/model/:type/:id',
        component: () => import('@/views/bpm/model/form/index.vue'),
        name: 'BpmModelUpdate',
        meta: {
          noCache: true,
          hidden: true,
          canTo: true,
          title: '修改流程',
          activeMenu: '/bpm/manager/model'
        }
      }
    ]
  },
  {
    path: '/crm',
    component: Layout,
    name: 'CrmCenter',
    meta: { hidden: true },
    children: [
      {
        path: 'clue/detail/:id',
        name: 'CrmClueDetail',
        meta: {
          title: '线索详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/clue'
        },
        component: () => import('@/views/crm/clue/detail/index.vue')
      },
      {
        path: 'customer/detail/:id',
        name: 'CrmCustomerDetail',
        meta: {
          title: '客户详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/customer'
        },
        component: () => import('@/views/crm/customer/detail/index.vue')
      },
      {
        path: 'business/detail/:id',
        name: 'CrmBusinessDetail',
        meta: {
          title: '商机详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/business'
        },
        component: () => import('@/views/crm/business/detail/index.vue')
      },
      {
        path: 'contract/detail/:id',
        name: 'CrmContractDetail',
        meta: {
          title: '合同详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/contract'
        },
        component: () => import('@/views/crm/contract/detail/index.vue')
      },
      {
        path: 'receivable-plan/detail/:id',
        name: 'CrmReceivablePlanDetail',
        meta: {
          title: '回款计划详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/receivable-plan'
        },
        component: () => import('@/views/crm/receivable/plan/detail/index.vue')
      },
      {
        path: 'receivable/detail/:id',
        name: 'CrmReceivableDetail',
        meta: {
          title: '回款详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/receivable'
        },
        component: () => import('@/views/crm/receivable/detail/index.vue')
      },
      {
        path: 'contact/detail/:id',
        name: 'CrmContactDetail',
        meta: {
          title: '联系人详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/contact'
        },
        component: () => import('@/views/crm/contact/detail/index.vue')
      },
      {
        path: 'product/detail/:id',
        name: 'CrmProductDetail',
        meta: {
          title: '产品详情',
          noCache: true,
          hidden: true,
          activeMenu: '/crm/product'
        },
        component: () => import('@/views/crm/product/detail/index.vue')
      }
    ]
  },
  {
    path: '/ai',
    component: Layout,
    name: 'Ai',
    meta: {
      hidden: true
    },
    children: [
      {
        path: 'image/square',
        component: () => import('@/views/ai/image/square/index.vue'),
        name: 'AiImageSquare',
        meta: {
          title: '绘图作品',
          icon: 'ep:home-filled',
          noCache: false
        }
      },
      {
        path: 'knowledge/document',
        component: () => import('@/views/ai/knowledge/document/index.vue'),
        name: 'AiKnowledgeDocument',
        meta: {
          title: '知识库文档',
          icon: 'ep:document',
          noCache: false,
          activeMenu: '/ai/knowledge'
        }
      },
      {
        path: 'knowledge/document/create',
        component: () => import('@/views/ai/knowledge/document/form/index.vue'),
        name: 'AiKnowledgeDocumentCreate',
        meta: {
          title: '创建文档',
          icon: 'ep:plus',
          noCache: true,
          hidden: true,
          activeMenu: '/ai/knowledge'
        }
      },
      {
        path: 'knowledge/document/update',
        component: () => import('@/views/ai/knowledge/document/form/index.vue'),
        name: 'AiKnowledgeDocumentUpdate',
        meta: {
          title: '修改文档',
          icon: 'ep:edit',
          noCache: true,
          hidden: true,
          activeMenu: '/ai/knowledge'
        }
      },
      {
        path: 'knowledge/retrieval',
        component: () => import('@/views/ai/knowledge/knowledge/retrieval/index.vue'),
        name: 'AiKnowledgeRetrieval',
        meta: {
          title: '文档召回测试',
          icon: 'ep:search',
          noCache: true,
          hidden: true,
          activeMenu: '/ai/knowledge'
        }
      },
      {
        path: 'knowledge/segment',
        component: () => import('@/views/ai/knowledge/segment/index.vue'),
        name: 'AiKnowledgeSegment',
        meta: {
          title: '知识库分段',
          icon: 'ep:tickets',
          noCache: true,
          hidden: true,
          activeMenu: '/ai/knowledge'
        }
      }
    ]
  },
  {
    path: '/im',
    name: 'Im',
    redirect: '/im/home/conversation',
    meta: { hidden: true, title: 'IM 即时通讯' },
    children: [
      {
        path: 'home',
        component: () => import('@/views/im/home/index.vue'),
        name: 'ImHome',
        redirect: '/im/home/conversation',
        meta: { hidden: true, title: '聊天' },
        children: [
          {
            path: 'conversation',
            component: () => import('@/views/im/home/pages/conversation/index.vue'),
            name: 'ImHomeConversation',
            meta: { hidden: true, title: '消息' }
          },
          {
            path: 'contact',
            component: () => import('@/views/im/home/pages/contact/index.vue'),
            name: 'ImHomeContact',
            meta: { hidden: true, title: '通讯录' }
          }
        ]
      }
    ]
  }
]

export default remainingRouter
