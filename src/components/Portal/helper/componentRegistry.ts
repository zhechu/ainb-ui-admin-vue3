import type { PortalConfig, PortalItem } from '@/api/infra/portal'
import { cloneDeep } from 'lodash-es'

export type PortalComponentGroup = 'layout' | 'basic' | 'system' | 'chart'

export type PortalComponentDefinition = {
  type: string
  label: string
  icon: string
  description: string
  group: PortalComponentGroup
  defaultProps: Record<string, any>
  defaultSize: { w: number; h: number }
}

export const PORTAL_SCHEMA_VERSION = 1

export const PORTAL_COMPONENT_GROUPS: Array<{
  key: PortalComponentGroup
  label: string
  icon: string
}> = [
  { key: 'layout', label: '布局控件', icon: 'ep:grid' },
  { key: 'basic', label: '基础控件', icon: 'ep:operation' },
  { key: 'system', label: '系统控件', icon: 'ep:setting' },
  { key: 'chart', label: '图表控件', icon: 'ep:data-analysis' }
]

const sampleImages = [
  {
    src: '',
    title: '欢迎使用工作门户',
    link: ''
  },
  {
    src: '',
    title: '统一查看业务信息',
    link: ''
  }
]

const sampleShortcuts = [
  { label: '用户管理', icon: 'ep:user', color: '#3473ff', url: '/system/user' },
  { label: '角色管理', icon: 'ep:avatar', color: '#16a085', url: '/system/role' },
  { label: '流程中心', icon: 'ep:connection', color: '#e67e22', url: '/bpm' },
  { label: '通知消息', icon: 'ep:message', color: '#d35400', url: '/user/notify-message' }
]

const cardProps = (title: string, values: Record<string, any> = {}) => ({
  title,
  showHeader: true,
  titleFontSize: 14,
  titleFontWeight: false,
  titleFontColor: '#303133',
  titleAlign: 'left',
  titleBackgroundColor: '',
  titleIcon: 'ep:postcard',
  titleIconColor: '#606266',
  actionText: '',
  actionUrl: '',
  actionTarget: '_self',
  ...values
})

const chartProps = (title: string, categories: string[], values: number[]) => ({
  ...cardProps(title, { titleIcon: 'ep:data-analysis' }),
  dataMode: 'static',
  interfaceCode: '',
  interfaceName: '',
  requestParams: '{}',
  refreshEnabled: false,
  refreshInterval: 300,
  mappingConfig: [],
  styleType: 1,
  categories,
  values,
  dataItems: categories.map((name, index) => ({ name, value: values[index] ?? 0 })),
  chartTitle: '',
  chartTitleColor: '#303133',
  chartTitleSize: 18,
  chartTitleWeight: true,
  chartTitleAlign: 'center',
  chartTitleBackground: '',
  chartSubtitle: '',
  chartSubtitleColor: '#667085',
  chartSubtitleSize: 12,
  chartSubtitleWeight: false,
  barWidth: 28,
  barRadius: 3,
  barStack: false,
  barGap: '30%',
  lineSmooth: true,
  lineWidth: 2,
  lineSymbol: 'circle',
  lineSymbolSize: 7,
  lineArea: false,
  xAxisShow: true,
  xAxisName: '',
  xAxisNameSize: 12,
  xAxisNameColor: '#667085',
  xAxisNameWeight: false,
  xAxisLabelSize: 12,
  xAxisLabelColor: '#667085',
  xAxisLabelWeight: false,
  xAxisLabelRotate: 0,
  xAxisSplitLineShow: false,
  xAxisSplitLineColor: '#edf0f5',
  xAxisInverse: false,
  yAxisShow: true,
  yAxisName: '',
  yAxisNameSize: 12,
  yAxisNameColor: '#667085',
  yAxisNameWeight: false,
  yAxisLabelSize: 12,
  yAxisLabelColor: '#667085',
  yAxisLabelWeight: false,
  yAxisSplitLineShow: true,
  yAxisSplitLineColor: '#edf0f5',
  yAxisInverse: false,
  valueShow: true,
  valuePosition: 'top',
  valueSize: 12,
  valueWeight: false,
  valueColor: '#303133',
  valueBackground: '',
  tooltipShow: true,
  tooltipTrigger: 'axis',
  tooltipSize: 12,
  tooltipWeight: false,
  tooltipColor: '#ffffff',
  tooltipBackground: 'rgb(17 24 39 / 92%)',
  marginLeft: 16,
  marginTop: 48,
  marginRight: 16,
  marginBottom: 28,
  centerX: 50,
  centerY: 50,
  legendShow: true,
  legendSize: 12,
  legendColor: '#667085',
  legendWeight: false,
  legendOrient: 'horizontal',
  legendLeft: 'center',
  legendTop: 'bottom',
  colors: ['#3473ff', '#16a085', '#e67e22', '#d35400', '#7b1ae1'],
  color: '#3473ff',
  pieInnerRadius: 0,
  pieOuterRadius: 68,
  pieRose: false,
  pieLabelPosition: 'outside',
  pieShowPercent: true,
  radarMax: 100,
  radarRadius: 62,
  radarShape: 'polygon',
  radarAreaOpacity: 0.25,
  jumpEnabled: false,
  jumpText: '查看详情',
  jumpUrl: '',
  jumpTarget: '_self'
})

const dataSourceProps = {
  dataMode: 'static',
  interfaceCode: '',
  interfaceName: '',
  requestParams: '{}',
  refreshEnabled: false,
  refreshInterval: 300,
  mappingConfig: [],
  jumpEnabled: false,
  jumpText: '查看详情',
  jumpUrl: '',
  jumpTarget: '_self'
}

export const PORTAL_DATA_SOURCE_TYPES = [
  'text',
  'image',
  'carousel',
  'video',
  'iframe',
  'commonFunc',
  'myTodo',
  'todoList',
  'doingList',
  'notice',
  'email',
  'dataBoard',
  'tableList',
  'chart.bar',
  'chart.line',
  'chart.pie',
  'chart.radar',
  'rankList',
  'timeAxis',
  'mapChart',
  'customEcharts'
] as const

const todoSummaryItems = [
  {
    id: 'pendingSign',
    label: '待签事项',
    value: 0,
    icon: 'ep:stamp',
    color: '#1997f4',
    url: '',
    hidden: false
  },
  {
    id: 'pendingTodo',
    label: '待办事项',
    value: 0,
    icon: 'ep:finished',
    color: '#f29700',
    url: '/bpm/task/todo',
    hidden: false
  },
  {
    id: 'running',
    label: '在办事项',
    value: 0,
    icon: 'ep:loading',
    color: '#495dfd',
    url: '/bpm/process-instance',
    hidden: false
  },
  {
    id: 'completed',
    label: '已办事项',
    value: 0,
    icon: 'ep:select',
    color: '#7b1ae1',
    url: '/bpm/task/done',
    hidden: false
  },
  {
    id: 'copied',
    label: '抄送事项',
    value: 0,
    icon: 'ep:bell',
    color: '#33b932',
    url: '/bpm/task/copy',
    hidden: false
  }
]

const noticeColumns = [
  {
    key: 'category',
    label: '分类',
    visible: true,
    fontSize: 12,
    fontWeight: false,
    color: '#667085'
  },
  { key: 'title', label: '标题', visible: true, fontSize: 14, fontWeight: false, color: '#303133' },
  {
    key: 'content',
    label: '摘要',
    visible: true,
    fontSize: 12,
    fontWeight: false,
    color: '#667085'
  },
  { key: 'time', label: '时间', visible: true, fontSize: 12, fontWeight: false, color: '#667085' }
]

const systemCardProps = (title: string, icon: string, values: Record<string, any> = {}) =>
  cardProps(title, { titleIcon: icon, ...values })

export const PORTAL_COMPONENTS: PortalComponentDefinition[] = [
  {
    type: 'card',
    label: '卡片面板',
    icon: 'ep:postcard',
    description: '提供可配置标题栏和内容承载区域',
    group: 'layout',
    defaultSize: { w: 12, h: 24 },
    defaultProps: { ...cardProps('卡片面板'), children: [] }
  },
  {
    type: 'tabs',
    label: '标签面板',
    icon: 'ep:files',
    description: '使用多个标签页组织相关业务内容',
    group: 'layout',
    defaultSize: { w: 24, h: 28 },
    defaultProps: {
      title: '信息面板',
      styleType: 'default',
      tabPosition: 'top',
      active: 'tab-1',
      tabs: [
        { id: 'tab-1', label: '概览', items: [] },
        { id: 'tab-2', label: '动态', items: [] }
      ]
    }
  },
  {
    type: 'text',
    label: '文本',
    icon: 'ep:document',
    description: '展示标题、说明或通知内容',
    group: 'basic',
    defaultSize: { w: 8, h: 14 },
    defaultProps: {
      ...cardProps('欢迎使用工作门户', { titleIcon: 'ep:document' }),
      ...dataSourceProps,
      content: '在这里查看重要信息和业务动态。',
      contentType: 'text',
      align: 'left',
      color: '#1f2937',
      fontSize: 14,
      fontWeight: false,
      fontStyle: false,
      underline: false,
      background: '#ffffff',
      textAutoplay: false,
      textAutoplayMode: 'left',
      textAutoplaySpeed: 20,
      link: '',
      linkTarget: '_self'
    }
  },
  {
    type: 'image',
    label: '图片',
    icon: 'ep:picture',
    description: '展示图片或品牌视觉内容',
    group: 'basic',
    defaultSize: { w: 12, h: 24 },
    defaultProps: {
      ...cardProps('门户图片', { titleIcon: 'ep:picture' }),
      ...dataSourceProps,
      src: '',
      alt: '门户图片',
      sourceType: 'url',
      objectFit: 'cover',
      link: '',
      linkTarget: '_self',
      caption: '',
      captionFontSize: 13,
      captionFontWeight: false,
      captionColor: '#ffffff',
      captionAlign: 'left',
      captionBackground: 'rgb(0 0 0 / 48%)',
      radius: 6
    }
  },
  {
    type: 'carousel',
    label: '轮播图',
    icon: 'ep:picture-rounded',
    description: '轮播展示多张图片和说明',
    group: 'basic',
    defaultSize: { w: 12, h: 24 },
    defaultProps: {
      ...cardProps('图片轮播', { titleIcon: 'ep:picture-rounded' }),
      ...dataSourceProps,
      direction: 'horizontal',
      autoplay: true,
      interval: 4000,
      indicator: 'outside',
      arrow: 'hover',
      objectFit: 'cover',
      captionFontSize: 13,
      captionFontWeight: false,
      captionColor: '#ffffff',
      captionAlign: 'left',
      captionBackground: 'rgb(0 0 0 / 48%)',
      images: sampleImages.map((image) => ({ ...image, sourceType: 'url', target: '_self' }))
    }
  },
  {
    type: 'video',
    label: '视频',
    icon: 'ep:video-play',
    description: '播放门户中的视频内容',
    group: 'basic',
    defaultSize: { w: 12, h: 24 },
    defaultProps: {
      ...cardProps('视频播放', { titleIcon: 'ep:video-play' }),
      ...dataSourceProps,
      sourceType: 'url',
      src: '',
      posterSourceType: 'url',
      poster: '',
      autoplay: false,
      controls: true,
      loop: false,
      muted: false,
      playbackRate: 1
    }
  },
  {
    type: 'iframe',
    label: '网页',
    icon: 'ep:link',
    description: '嵌入受信任的外部网页',
    group: 'basic',
    defaultSize: { w: 12, h: 28 },
    defaultProps: {
      ...cardProps('外部网页', { titleIcon: 'ep:link' }),
      ...dataSourceProps,
      url: '',
      frameTitle: '外部网页',
      allow: 'fullscreen'
    }
  },
  {
    type: 'commonFunc',
    label: '常用功能',
    icon: 'ep:guide',
    description: '用图标和文字组成常用业务入口',
    group: 'basic',
    defaultSize: { w: 12, h: 20 },
    defaultProps: {
      ...cardProps('常用功能', { titleIcon: 'ep:guide' }),
      ...dataSourceProps,
      columns: 4,
      showBorder: true,
      iconPosition: 'top',
      labelFontSize: 13,
      labelFontWeight: false,
      labelFontColor: '#475467',
      items: sampleShortcuts.map((item) => ({ ...item, target: '_self' }))
    }
  },
  {
    type: 'myTodo',
    label: '我的待办',
    icon: 'ep:finished',
    description: '集中展示当前用户需要处理和关注的流程事项',
    group: 'system',
    defaultSize: { w: 24, h: 18 },
    defaultProps: {
      ...systemCardProps('我的待办', 'ep:finished'),
      ...dataSourceProps,
      interfaceCode: '',
      columns: 5,
      showBorder: false,
      labelFontSize: 14,
      labelFontWeight: false,
      labelFontColor: '#606266',
      valueFontSize: 24,
      valueFontWeight: true,
      valueFontColor: '#303133',
      items: todoSummaryItems
    }
  },
  {
    type: 'todoList',
    label: '待办事项',
    icon: 'ep:finished',
    description: '展示当前用户需要处理的流程任务',
    group: 'system',
    defaultSize: { w: 12, h: 22 },
    defaultProps: {
      ...systemCardProps('待办事项', 'ep:finished'),
      ...dataSourceProps,
      interfaceCode: '',
      pageSize: 7,
      items: []
    }
  },
  {
    type: 'doingList',
    label: '在办事项',
    icon: 'ep:loading',
    description: '展示当前用户发起且仍在流转中的流程',
    group: 'system',
    defaultSize: { w: 12, h: 22 },
    defaultProps: {
      ...systemCardProps('在办事项', 'ep:loading'),
      ...dataSourceProps,
      interfaceCode: '',
      pageSize: 7,
      items: []
    }
  },
  {
    type: 'notice',
    label: '公告通知',
    icon: 'ep:bell',
    description: '展示系统公告和重要通知',
    group: 'system',
    defaultSize: { w: 24, h: 28 },
    defaultProps: {
      ...systemCardProps('公告通知', 'ep:bell'),
      ...dataSourceProps,
      interfaceCode: '',
      styleType: 'table',
      border: true,
      showOverflow: true,
      tableShowHeader: true,
      showIndex: true,
      count: 5,
      showImage: false,
      headerFontSize: 14,
      headerFontWeight: false,
      headerFontColor: '#303133',
      headerAlign: 'center',
      headerBackgroundColor: '#f3f6f9',
      rowFontSize: 14,
      rowFontColor: '#606266',
      rowBackgroundColor: '',
      oddRowColor: '',
      evenRowColor: '',
      columns: noticeColumns,
      items: [
        {
          id: 1,
          title: '系统维护通知',
          date: '今天 09:30',
          category: '通知',
          content: '系统将进行例行维护',
          url: ''
        },
        {
          id: 2,
          title: '新版本功能已上线',
          date: '昨天 16:20',
          category: '公告',
          content: '门户功能已完成更新',
          url: ''
        },
        {
          id: 3,
          title: '本月工作安排',
          date: '2026-09-01',
          category: '公告',
          content: '请关注本月工作安排',
          url: ''
        }
      ]
    }
  },
  {
    type: 'email',
    label: '邮件消息',
    icon: 'ep:message',
    description: '展示最近收到的邮件消息',
    group: 'system',
    defaultSize: { w: 12, h: 24 },
    defaultProps: {
      title: '邮件消息',
      ...dataSourceProps,
      interfaceCode: '',
      items: [
        { subject: '项目周报已提交', sender: '项目管理组', date: '今天 10:15', unread: true },
        { subject: '会议邀请：季度复盘', sender: '行政部', date: '昨天 15:40', unread: false },
        { subject: '费用报销审批结果', sender: '财务部', date: '2026-09-01', unread: false }
      ]
    }
  },
  {
    type: 'dataBoard',
    label: '数据面板',
    icon: 'ep:odometer',
    description: '用指标卡片突出展示关键数据',
    group: 'chart',
    defaultSize: { w: 24, h: 16 },
    defaultProps: {
      ...cardProps('经营概览', { titleIcon: 'ep:odometer' }),
      ...dataSourceProps,
      columns: 4,
      showBorder: false,
      labelFontSize: 13,
      labelFontWeight: false,
      labelFontColor: '#667085',
      valueFontSize: 22,
      valueFontWeight: true,
      valueFontColor: '#172033',
      items: [
        {
          label: '新增客户',
          value: '262',
          unit: '个',
          icon: 'ep:user',
          color: '#3473ff',
          url: '',
          dataField: 'newCustomer'
        },
        {
          label: '新增商机',
          value: '199',
          unit: '个',
          icon: 'ep:aim',
          color: '#16a085',
          url: '',
          dataField: 'newOpportunity'
        },
        {
          label: '合同金额',
          value: '126.3',
          unit: '万元',
          icon: 'ep:wallet',
          color: '#e67e22',
          url: '',
          dataField: 'contractAmount'
        },
        {
          label: '回款金额',
          value: '62.2',
          unit: '万元',
          icon: 'ep:coin',
          color: '#d35400',
          url: '',
          dataField: 'paymentAmount'
        }
      ]
    }
  },
  {
    type: 'tableList',
    label: '表格列表',
    icon: 'ep:document-copy',
    description: '以表格形式展示业务数据',
    group: 'chart',
    defaultSize: { w: 24, h: 28 },
    defaultProps: {
      ...cardProps('数据列表', { titleIcon: 'ep:document-copy' }),
      ...dataSourceProps,
      tableBorder: false,
      tableStripe: true,
      tableShowHeader: true,
      tableSize: 'small',
      tableMaxRows: 50,
      columns: [
        { key: 'code', label: '编号', visible: true, width: 110, align: 'left' },
        { key: 'name', label: '名称', visible: true, width: 160, align: 'left' },
        { key: 'owner', label: '负责人', visible: true, width: 100, align: 'left' },
        { key: 'status', label: '状态', visible: true, width: 100, align: 'center' }
      ],
      rows: [
        { code: 'A-001', name: '华东区域项目', owner: '张三', status: '进行中' },
        { code: 'A-002', name: '年度客户回访', owner: '李四', status: '已完成' },
        { code: 'A-003', name: '产品需求评审', owner: '王五', status: '待开始' }
      ]
    }
  },
  {
    type: 'chart.bar',
    label: '柱状图',
    icon: 'ep:histogram',
    description: '展示分类数据的数量对比',
    group: 'chart',
    defaultSize: { w: 12, h: 28 },
    defaultProps: chartProps('分类对比', ['一月', '二月', '三月', '四月'], [120, 180, 150, 220])
  },
  {
    type: 'chart.line',
    label: '折线图',
    icon: 'ep:data-line',
    description: '展示数据随时间的变化趋势',
    group: 'chart',
    defaultSize: { w: 12, h: 28 },
    defaultProps: chartProps('趋势分析', ['一月', '二月', '三月', '四月'], [120, 180, 150, 220])
  },
  {
    type: 'chart.pie',
    label: '饼图',
    icon: 'ep:pie-chart',
    description: '展示结构和占比数据',
    group: 'chart',
    defaultSize: { w: 12, h: 28 },
    defaultProps: chartProps('结构占比', ['一类', '二类', '三类'], [40, 35, 25])
  },
  {
    type: 'chart.radar',
    label: '雷达图',
    icon: 'ep:trend-charts',
    description: '展示多维指标数据',
    group: 'chart',
    defaultSize: { w: 12, h: 28 },
    defaultProps: chartProps(
      '能力模型',
      ['效率', '质量', '交付', '成本', '满意度'],
      [80, 72, 90, 65, 88]
    )
  },
  {
    type: 'rankList',
    label: '排行榜',
    icon: 'ep:sort-up',
    description: '按数值顺序展示排行数据',
    group: 'chart',
    defaultSize: { w: 12, h: 24 },
    defaultProps: {
      ...cardProps('部门排行', { titleIcon: 'ep:sort-up' }),
      ...dataSourceProps,
      rankLimit: 10,
      styleType: 1,
      showRankNumber: true,
      showRankValue: true,
      valueColor: '#172033',
      valueSuffix: '',
      items: [
        { label: '北京销售部', value: '895,560', url: '' },
        { label: '上海销售部', value: '829,546', url: '' },
        { label: '深圳销售部', value: '465,645', url: '' },
        { label: '厦门销售部', value: '146,564', url: '' },
        { label: '广州销售部', value: '125,264', url: '' }
      ]
    }
  },
  {
    type: 'timeAxis',
    label: '时间轴',
    icon: 'ep:timer',
    description: '按时间顺序展示过程节点',
    group: 'chart',
    defaultSize: { w: 12, h: 24 },
    defaultProps: {
      ...cardProps('流程动态', { titleIcon: 'ep:timer' }),
      ...dataSourceProps,
      styleType: 1,
      timelineLayout: 'alternate',
      timelineSort: 'asc',
      timelineLimit: 50,
      timelineShowTime: true,
      timelineShowIndex: false,
      timelineNodeColor: '#3473ff',
      timelineLineColor: '#d5deeb',
      items: [
        { timestamp: '09:00', content: '提交申请', url: '' },
        { timestamp: '10:30', content: '部门负责人审批', url: '' },
        { timestamp: '13:20', content: '财务复核', url: '' },
        { timestamp: '16:00', content: '流程完成', url: '' }
      ]
    }
  },
  {
    type: 'mapChart',
    label: '地图',
    icon: 'ep:map-location',
    description: '在地图上展示区域数据和分布情况',
    group: 'chart',
    defaultSize: { w: 12, h: 28 },
    defaultProps: {
      ...cardProps('区域分布', { titleIcon: 'ep:map-location' }),
      ...dataSourceProps,
      mapStyleType: 'region',
      mapName: 'china',
      mapRoam: true,
      mapScale: 1,
      mapAreaColor: '#eef4ff',
      mapBorderColor: '#9db7e8',
      mapBorderWidth: 1,
      mapLabelShow: false,
      mapLabelColor: '#344054',
      mapLabelSize: 11,
      mapLabelWeight: false,
      mapCenterX: 50,
      mapCenterY: 52,
      mapPointSize: 8,
      mapBlurSize: 20,
      mapPointOpacity: 1,
      mapBarWidth: 10,
      mapRankLimit: 8,
      mapRankTitle: '数据统计排名',
      mapRankTitleSize: 14,
      mapRankTitleColor: '#303133',
      mapRankGridTop: 35,
      mapRankGridRight: 16,
      mapRankGridBottom: 24,
      mapVisualMin: 0,
      mapVisualMax: 200,
      mapShowVisualMap: true,
      mapVisualMapType: 'continuous',
      mapDrillDown: false,
      chartTitle: '',
      chartTitleColor: '#303133',
      chartTitleSize: 18,
      chartTitleWeight: true,
      chartTitleAlign: 'center',
      chartTitleBackground: '',
      chartSubtitle: '',
      chartSubtitleColor: '#667085',
      chartSubtitleSize: 12,
      chartSubtitleWeight: false,
      tooltipShow: true,
      tooltipTrigger: 'item',
      tooltipSize: 12,
      tooltipWeight: false,
      tooltipColor: '#ffffff',
      tooltipBackground: 'rgb(17 24 39 / 92%)',
      colors: ['#3473ff', '#16a085', '#e67e22', '#d35400'],
      mapData: [
        { name: '北京市', value: 120, longitude: 116.46, latitude: 39.92 },
        { name: '上海市', value: 180, longitude: 121.48, latitude: 31.22 },
        { name: '广东省', value: 150, longitude: 113.23, latitude: 23.16 },
        { name: '浙江省', value: 90, longitude: 120.19, latitude: 30.26 }
      ]
    }
  },
  {
    type: 'customEcharts',
    label: '自定义 ECharts',
    icon: 'ep:data-analysis',
    description: '使用 JSON 配置绘制自定义 ECharts 图表',
    group: 'chart',
    defaultSize: { w: 12, h: 28 },
    defaultProps: {
      ...cardProps('自定义 ECharts', { titleIcon: 'ep:data-analysis' }),
      ...dataSourceProps,
      customOption: {
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: ['一月', '二月', '三月', '四月'] },
        yAxis: { type: 'value' },
        series: [{ type: 'line', data: [120, 180, 150, 220], smooth: true }]
      }
    }
  }
]

const componentAliases: Record<string, string> = {
  shortcut: 'commonFunc',
  icon: 'commonFunc',
  todo: 'myTodo'
}

export const normalizeComponentType = (type: string) => componentAliases[type] || type

export const getComponentDefinition = (type: string) =>
  PORTAL_COMPONENTS.find((item) => item.type === normalizeComponentType(type)) ||
  PORTAL_COMPONENTS[0]

export const getComponentsByGroup = (group: PortalComponentGroup) =>
  PORTAL_COMPONENTS.filter((item) => item.group === group)

export const createDefaultPortalConfig = (): PortalConfig => ({
  schemaVersion: PORTAL_SCHEMA_VERSION,
  columns: 24,
  rowHeight: 8,
  gap: 12,
  background: '#f4f7fb',
  items: []
})

const createId = (index: number) =>
  `portal_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`

export const createPortalItem = (type: string, index = 0, nested = false): PortalItem => {
  const definition = getComponentDefinition(type)
  return {
    id: createId(index),
    type: definition.type,
    x: nested ? 0 : (index * 4) % 16,
    y: nested ? 0 : Math.floor(index / 3) * 20,
    w: definition.defaultSize.w,
    h: definition.defaultSize.h,
    props: cloneDeep(definition.defaultProps)
  }
}

const normalizeItem = (item: any, index: number): PortalItem | null => {
  if (!item || typeof item !== 'object' || typeof item.type !== 'string') return null
  const type = normalizeComponentType(item.type)
  const definition = getComponentDefinition(type)
  const rawProps = item.props && typeof item.props === 'object' ? item.props : {}
  const mergedProps = {
    ...cloneDeep(definition.defaultProps),
    ...rawProps
  }
  if (
    PORTAL_DATA_SOURCE_TYPES.includes(type as (typeof PORTAL_DATA_SOURCE_TYPES)[number]) &&
    rawProps.dataMode === undefined &&
    typeof rawProps.interfaceCode === 'string' &&
    rawProps.interfaceCode
  ) {
    mergedProps.dataMode = 'dynamic'
  }
  if (
    ['chart.bar', 'chart.line', 'chart.pie', 'chart.radar'].includes(type) &&
    rawProps.dataItems === undefined &&
    (rawProps.categories !== undefined || rawProps.values !== undefined)
  ) {
    delete mergedProps.dataItems
  }
  const props = normalizeItemProps(type, mergedProps)
  const x = Number.isFinite(item.x)
    ? Math.max(0, Math.min(23, Math.trunc(item.x)))
    : (index * 4) % 16
  const w = Number.isFinite(item.w)
    ? Math.max(1, Math.min(24 - x, Math.trunc(item.w)))
    : Math.min(definition.defaultSize.w, 24 - x)
  return {
    id: typeof item.id === 'string' && item.id ? item.id : createId(index),
    type: definition.type,
    x,
    y: Number.isFinite(item.y) ? Math.max(0, Math.trunc(item.y)) : Math.floor(index / 3) * 20,
    w,
    h: Number.isFinite(item.h) ? Math.max(1, Math.trunc(item.h)) : definition.defaultSize.h,
    props: { ...cloneDeep(definition.defaultProps), ...props }
  }
}

const normalizeNestedItems = (items: unknown): PortalItem[] =>
  Array.isArray(items)
    ? (items.map((item, index) => normalizeItem(item, index)).filter(Boolean) as PortalItem[])
    : []

const portalMappingDefaults: Record<
  string,
  Array<{ key: string; field: string; value: string }>
> = {
  'chart.bar': [
    { key: 'series', field: 'series', value: '' },
    { key: 'dimension', field: 'dimension', value: '' },
    { key: 'value', field: 'value', value: '' }
  ],
  'chart.line': [
    { key: 'series', field: 'series', value: '' },
    { key: 'dimension', field: 'dimension', value: '' },
    { key: 'value', field: 'value', value: '' }
  ],
  'chart.pie': [
    { key: 'dimension', field: 'dimension', value: '' },
    { key: 'value', field: 'value', value: '' }
  ],
  'chart.radar': [
    { key: 'series', field: 'series', value: '' },
    { key: 'dimension', field: 'dimension', value: '' },
    { key: 'value', field: 'value', value: '' },
    { key: 'max', field: 'max', value: '' }
  ],
  timeAxis: [
    { key: 'content', field: 'content', value: '' },
    { key: 'timestamp', field: 'timestamp', value: '' }
  ],
  mapChart: [
    { key: 'name', field: 'name', value: '' },
    { key: 'value', field: 'value', value: '' },
    { key: 'longitude', field: 'longitude', value: '' },
    { key: 'latitude', field: 'latitude', value: '' }
  ],
  text: [
    { key: 'content', field: 'content', value: '' },
    { key: 'link', field: 'link', value: '' }
  ],
  image: [
    { key: 'src', field: 'src', value: '' },
    { key: 'alt', field: 'alt', value: '' },
    { key: 'caption', field: 'caption', value: '' },
    { key: 'link', field: 'link', value: '' }
  ],
  carousel: [
    { key: 'src', field: 'src', value: '' },
    { key: 'title', field: 'title', value: '' },
    { key: 'link', field: 'link', value: '' }
  ],
  video: [
    { key: 'src', field: 'src', value: '' },
    { key: 'poster', field: 'poster', value: '' }
  ],
  iframe: [{ key: 'url', field: 'url', value: '' }],
  commonFunc: [
    { key: 'label', field: 'label', value: '' },
    { key: 'icon', field: 'icon', value: '' },
    { key: 'color', field: 'color', value: '' },
    { key: 'url', field: 'url', value: '' }
  ],
  myTodo: [
    { key: 'label', field: 'label', value: '' },
    { key: 'value', field: 'value', value: '' },
    { key: 'url', field: 'url', value: '' }
  ],
  todoList: [
    { key: 'name', field: 'name', value: '' },
    { key: 'processName', field: 'processName', value: '' },
    { key: 'createTime', field: 'createTime', value: '' },
    { key: 'url', field: 'url', value: '' }
  ],
  doingList: [
    { key: 'name', field: 'name', value: '' },
    { key: 'processName', field: 'processName', value: '' },
    { key: 'createTime', field: 'createTime', value: '' },
    { key: 'url', field: 'url', value: '' }
  ],
  notice: [
    { key: 'title', field: 'title', value: '' },
    { key: 'category', field: 'category', value: '' },
    { key: 'content', field: 'content', value: '' },
    { key: 'time', field: 'time', value: '' },
    { key: 'url', field: 'url', value: '' }
  ],
  rankList: [
    { key: 'label', field: 'label', value: '' },
    { key: 'value', field: 'value', value: '' },
    { key: 'url', field: 'url', value: '' }
  ],
  email: [
    { key: 'subject', field: 'subject', value: '' },
    { key: 'sender', field: 'sender', value: '' },
    { key: 'date', field: 'date', value: '' },
    { key: 'unread', field: 'unread', value: '' }
  ]
}

const normalizeItemProps = (type: string, props: Record<string, any>) => {
  const normalized = { ...props }

  if (type === 'commonFunc') {
    normalized.title = normalized.title || '常用功能'
    normalized.columns = clampNumber(normalized.columns, 1, 8, 4)
    normalized.showBorder = normalized.showBorder !== false
    normalized.iconPosition = normalized.iconPosition === 'left' ? 'left' : 'top'
    normalized.labelFontSize = clampNumber(normalized.labelFontSize, 10, 25, 13)
    normalized.labelFontWeight = normalized.labelFontWeight === true
    normalized.labelFontColor = normalized.labelFontColor || '#475467'
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any) => ({
          label: typeof entry?.label === 'string' ? entry.label : '',
          icon: typeof entry?.icon === 'string' ? entry.icon : 'ep:link',
          color: entry?.color || '#3473ff',
          url: typeof entry?.url === 'string' ? entry.url : '',
          target: entry?.target === '_blank' ? '_blank' : '_self'
        }))
      : []
  }

  if (['text', 'image', 'carousel', 'video', 'iframe'].includes(type)) {
    normalized.showHeader = normalized.showHeader !== false
    normalized.titleFontSize = clampNumber(normalized.titleFontSize, 12, 25, 14)
    normalized.titleFontWeight = normalized.titleFontWeight === true
    normalized.titleFontColor = normalized.titleFontColor || '#303133'
    normalized.titleAlign = ['left', 'center', 'right'].includes(normalized.titleAlign)
      ? normalized.titleAlign
      : 'left'
    normalized.titleBackgroundColor = normalized.titleBackgroundColor || ''
    normalized.titleIconColor = normalized.titleIconColor || '#606266'
    normalized.actionText = normalized.actionText || ''
    normalized.actionUrl = normalized.actionUrl || ''
    normalized.actionTarget = normalized.actionTarget === '_blank' ? '_blank' : '_self'
  }

  if (type === 'text') {
    normalized.contentType = normalized.contentType === 'rich' ? 'rich' : 'text'
    normalized.align = ['left', 'center', 'right'].includes(normalized.align)
      ? normalized.align
      : 'left'
    normalized.fontSize = clampNumber(normalized.fontSize, 10, 48, 14)
    normalized.fontWeight = normalized.fontWeight === true
    normalized.fontStyle = normalized.fontStyle === true
    normalized.underline = normalized.underline === true
    normalized.textAutoplay = normalized.textAutoplay === true
    normalized.textAutoplayMode = normalized.textAutoplayMode === 'up' ? 'up' : 'left'
    normalized.textAutoplaySpeed = clampNumber(normalized.textAutoplaySpeed, 10, 100, 20)
    normalized.linkTarget = normalized.linkTarget === '_blank' ? '_blank' : '_self'
  }

  if (type === 'image') {
    normalized.sourceType = normalized.sourceType === 'upload' ? 'upload' : 'url'
    normalized.objectFit = ['cover', 'contain', 'fill'].includes(normalized.objectFit)
      ? normalized.objectFit
      : 'cover'
    normalized.linkTarget = normalized.linkTarget === '_blank' ? '_blank' : '_self'
    normalized.captionFontSize = clampNumber(normalized.captionFontSize, 10, 25, 13)
    normalized.captionFontWeight = normalized.captionFontWeight === true
    normalized.captionColor = normalized.captionColor || '#ffffff'
    normalized.captionAlign = ['left', 'center', 'right'].includes(normalized.captionAlign)
      ? normalized.captionAlign
      : 'left'
    normalized.captionBackground = normalized.captionBackground || 'rgb(0 0 0 / 48%)'
  }

  if (type === 'carousel') {
    normalized.direction = normalized.direction === 'vertical' ? 'vertical' : 'horizontal'
    normalized.autoplay = normalized.autoplay !== false
    normalized.interval = clampNumber(normalized.interval, 500, 500000, 4000)
    normalized.indicator = ['outside', 'none'].includes(normalized.indicator)
      ? normalized.indicator
      : 'outside'
    normalized.arrow = ['hover', 'always', 'never'].includes(normalized.arrow)
      ? normalized.arrow
      : 'hover'
    normalized.objectFit = ['cover', 'contain', 'fill'].includes(normalized.objectFit)
      ? normalized.objectFit
      : 'cover'
    normalized.captionFontSize = clampNumber(normalized.captionFontSize, 10, 25, 13)
    normalized.captionFontWeight = normalized.captionFontWeight === true
    normalized.captionColor = normalized.captionColor || '#ffffff'
    normalized.captionAlign = ['left', 'center', 'right'].includes(normalized.captionAlign)
      ? normalized.captionAlign
      : 'left'
    normalized.captionBackground = normalized.captionBackground || 'rgb(0 0 0 / 48%)'
    normalized.images = Array.isArray(normalized.images)
      ? normalized.images.map((image: any) => ({
          src: typeof image?.src === 'string' ? image.src : '',
          sourceType: image?.sourceType === 'upload' ? 'upload' : 'url',
          title: typeof image?.title === 'string' ? image.title : '',
          link: typeof image?.link === 'string' ? image.link : '',
          target: image?.target === '_blank' ? '_blank' : '_self'
        }))
      : []
  }

  if (type === 'video') {
    normalized.sourceType = normalized.sourceType === 'upload' ? 'upload' : 'url'
    normalized.posterSourceType = normalized.posterSourceType === 'upload' ? 'upload' : 'url'
    normalized.autoplay = normalized.autoplay === true
    normalized.controls = normalized.controls !== false
    normalized.loop = normalized.loop === true
    normalized.muted = normalized.muted === true
    normalized.playbackRate = [0.5, 1, 1.5, 2].includes(Number(normalized.playbackRate))
      ? Number(normalized.playbackRate)
      : 1
  }

  if (type === 'iframe') {
    normalized.frameTitle = normalized.frameTitle || normalized.title || '外部网页'
    normalized.allow = normalized.allow || 'fullscreen'
  }

  if (PORTAL_DATA_SOURCE_TYPES.includes(type as (typeof PORTAL_DATA_SOURCE_TYPES)[number])) {
    normalized.interfaceCode =
      typeof normalized.interfaceCode === 'string' ? normalized.interfaceCode : ''
    normalized.interfaceName =
      typeof normalized.interfaceName === 'string' ? normalized.interfaceName : ''
    normalized.dataMode = normalized.dataMode === 'dynamic' ? 'dynamic' : 'static'
    normalized.requestParams =
      typeof normalized.requestParams === 'string' ? normalized.requestParams : '{}'
    normalized.refreshEnabled = normalized.refreshEnabled === true
    normalized.refreshInterval = clampNumber(normalized.refreshInterval, 10, 86400, 300)
    normalized.mappingConfig =
      Array.isArray(normalized.mappingConfig) && normalized.mappingConfig.length
        ? normalized.mappingConfig.map((entry: any) => ({
            key: typeof entry?.key === 'string' ? entry.key : entry?.field,
            field: typeof entry?.field === 'string' ? entry.field : entry?.key,
            value: typeof entry?.value === 'string' ? entry.value : ''
          }))
        : cloneDeep(portalMappingDefaults[type] || [])
  }

  if (['myTodo', 'todoList', 'doingList', 'notice'].includes(type)) {
    const defaultProps = getComponentDefinition(type).defaultProps
    normalized.title = normalized.title || defaultProps.title
    normalized.showHeader = normalized.showHeader !== false
    normalized.titleFontSize = clampNumber(normalized.titleFontSize, 12, 25, 14)
    normalized.titleFontWeight = normalized.titleFontWeight === true
    normalized.titleFontColor = normalized.titleFontColor || '#303133'
    normalized.titleAlign = ['left', 'center', 'right'].includes(normalized.titleAlign)
      ? normalized.titleAlign
      : 'left'
    normalized.titleBackgroundColor = normalized.titleBackgroundColor || ''
    normalized.titleIcon = normalized.titleIcon || defaultProps.titleIcon || 'ep:postcard'
    normalized.titleIconColor = normalized.titleIconColor || '#606266'
    normalized.actionText = normalized.actionText || ''
    normalized.actionUrl = normalized.actionUrl || ''
    normalized.actionTarget = normalized.actionTarget === '_blank' ? '_blank' : '_self'
  }

  if (type === 'myTodo') {
    normalized.columns = clampNumber(normalized.columns, 1, 10, 5)
    normalized.showBorder = normalized.showBorder === true
    normalized.labelFontSize = clampNumber(normalized.labelFontSize, 10, 25, 14)
    normalized.labelFontWeight = normalized.labelFontWeight === true
    normalized.labelFontColor = normalized.labelFontColor || '#606266'
    normalized.valueFontSize = clampNumber(normalized.valueFontSize, 12, 40, 24)
    normalized.valueFontWeight = normalized.valueFontWeight !== false
    normalized.valueFontColor = normalized.valueFontColor || '#303133'
    const items = Array.isArray(normalized.items) ? normalized.items : defaultTodoItems()
    normalized.items = items.map((entry: any, index: number) => ({
      id: typeof entry?.id === 'string' && entry.id ? entry.id : `todo-${index + 1}`,
      label: typeof entry?.label === 'string' ? entry.label : `事项${index + 1}`,
      value: Number.isFinite(Number(entry?.value)) ? Number(entry.value) : 0,
      icon: typeof entry?.icon === 'string' ? entry.icon : 'ep:document',
      color: entry?.color || '#3473ff',
      url: typeof entry?.url === 'string' ? entry.url : '',
      hidden: entry?.hidden === true
    }))
  }

  if (type === 'todoList' || type === 'doingList') {
    normalized.pageSize = clampNumber(normalized.pageSize, 1, 50, 7)
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any) => ({
          id: entry?.id,
          name:
            typeof entry?.name === 'string'
              ? entry.name
              : typeof entry?.label === 'string'
                ? entry.label
                : '',
          processName:
            typeof entry?.processName === 'string'
              ? entry.processName
              : typeof entry?.process === 'string'
                ? entry.process
                : '',
          createTime: entry?.createTime || entry?.date || '',
          processInstanceId: entry?.processInstanceId || '',
          taskId: entry?.taskId || '',
          url: typeof entry?.url === 'string' ? entry.url : ''
        }))
      : []
  }

  if (type === 'notice') {
    normalized.styleType = ['table', 'horizontal', 'vertical'].includes(normalized.styleType)
      ? normalized.styleType
      : 'table'
    normalized.border = normalized.border !== false
    normalized.showOverflow = normalized.showOverflow !== false
    normalized.tableShowHeader = normalized.tableShowHeader !== false
    normalized.showIndex = normalized.showIndex !== false
    normalized.count = clampNumber(normalized.count, 1, 50, 5)
    normalized.showImage = normalized.showImage === true
    normalized.headerFontSize = clampNumber(normalized.headerFontSize, 12, 25, 14)
    normalized.headerFontWeight = normalized.headerFontWeight === true
    normalized.headerFontColor = normalized.headerFontColor || '#303133'
    normalized.headerAlign = ['left', 'center', 'right'].includes(normalized.headerAlign)
      ? normalized.headerAlign
      : 'center'
    normalized.headerBackgroundColor = normalized.headerBackgroundColor || '#f3f6f9'
    normalized.rowFontSize = clampNumber(normalized.rowFontSize, 12, 25, 14)
    normalized.rowFontColor = normalized.rowFontColor || '#606266'
    normalized.rowBackgroundColor = normalized.rowBackgroundColor || ''
    normalized.oddRowColor = normalized.oddRowColor || ''
    normalized.evenRowColor = normalized.evenRowColor || ''
    const columns = Array.isArray(normalized.columns)
      ? normalized.columns
      : cloneDeep(noticeColumns)
    normalized.columns = columns.map((entry: any, index: number) => ({
      key: ['category', 'title', 'content', 'time', 'creator'].includes(entry?.key)
        ? entry.key
        : noticeColumns[index % noticeColumns.length].key,
      label: typeof entry?.label === 'string' && entry.label ? entry.label : `字段${index + 1}`,
      visible: entry?.visible !== false,
      fontSize: clampNumber(entry?.fontSize, 10, 25, 14),
      fontWeight: entry?.fontWeight === true,
      color: entry?.color || '#606266'
    }))
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any) => ({
          id: entry?.id,
          title: typeof entry?.title === 'string' ? entry.title : '',
          category:
            typeof entry?.category === 'string'
              ? entry.category
              : typeof entry?.type === 'string'
                ? entry.type
                : '',
          content: typeof entry?.content === 'string' ? entry.content : '',
          date:
            typeof entry?.date === 'string'
              ? entry.date
              : typeof entry?.time === 'string'
                ? entry.time
                : '',
          creator: typeof entry?.creator === 'string' ? entry.creator : '',
          url: typeof entry?.url === 'string' ? entry.url : ''
        }))
      : []
  }

  if (type === 'email') {
    normalized.title = normalized.title || '邮件消息'
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any) => ({
          subject:
            typeof entry?.subject === 'string'
              ? entry.subject
              : typeof entry?.title === 'string'
                ? entry.title
                : '',
          sender:
            typeof entry?.sender === 'string'
              ? entry.sender
              : typeof entry?.from === 'string'
                ? entry.from
                : '',
          date: entry?.date || entry?.time || entry?.createTime || '',
          unread: entry?.unread === true || entry?.read === false,
          url: typeof entry?.url === 'string' ? entry.url : ''
        }))
      : []
  }

  const portalCardTypes = [
    'dataBoard',
    'tableList',
    'chart.bar',
    'chart.line',
    'chart.pie',
    'chart.radar',
    'rankList',
    'timeAxis',
    'mapChart',
    'customEcharts'
  ]
  if (portalCardTypes.includes(type)) {
    const defaultProps = getComponentDefinition(type).defaultProps
    normalized.title = normalized.title || defaultProps.title || '门户控件'
    normalized.showHeader = normalized.showHeader !== false
    normalized.titleFontSize = clampNumber(normalized.titleFontSize, 12, 25, 14)
    normalized.titleFontWeight = normalized.titleFontWeight === true
    normalized.titleFontColor = normalized.titleFontColor || '#303133'
    normalized.titleAlign = ['left', 'center', 'right'].includes(normalized.titleAlign)
      ? normalized.titleAlign
      : 'left'
    normalized.titleBackgroundColor = normalized.titleBackgroundColor || ''
    normalized.titleIcon = normalized.titleIcon || defaultProps.titleIcon || 'ep:data-analysis'
    normalized.titleIconColor = normalized.titleIconColor || '#606266'
    normalized.actionText = normalized.actionText || ''
    normalized.actionUrl = normalized.actionUrl || ''
    normalized.actionTarget = normalized.actionTarget === '_blank' ? '_blank' : '_self'
    normalized.jumpEnabled = normalized.jumpEnabled === true
    normalized.jumpText = normalized.jumpText || '查看详情'
    normalized.jumpUrl = typeof normalized.jumpUrl === 'string' ? normalized.jumpUrl : ''
    normalized.jumpTarget = normalized.jumpTarget === '_blank' ? '_blank' : '_self'
  }

  if (type === 'dataBoard') {
    normalized.columns = clampNumber(normalized.columns, 1, 8, 4)
    normalized.showBorder = normalized.showBorder === true
    normalized.labelFontSize = clampNumber(normalized.labelFontSize, 10, 25, 13)
    normalized.labelFontWeight = normalized.labelFontWeight === true
    normalized.labelFontColor = normalized.labelFontColor || '#667085'
    normalized.valueFontSize = clampNumber(normalized.valueFontSize, 12, 40, 22)
    normalized.valueFontWeight = normalized.valueFontWeight !== false
    normalized.valueFontColor = normalized.valueFontColor || '#172033'
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any, index: number) => ({
          id: typeof entry?.id === 'string' && entry.id ? entry.id : `metric-${index + 1}`,
          label: typeof entry?.label === 'string' ? entry.label : `指标${index + 1}`,
          value: entry?.value ?? 0,
          unit: typeof entry?.unit === 'string' ? entry.unit : '',
          icon: typeof entry?.icon === 'string' ? entry.icon : 'ep:data-line',
          color: entry?.color || '#3473ff',
          url: typeof entry?.url === 'string' ? entry.url : '',
          dataField:
            typeof entry?.dataField === 'string' && entry.dataField
              ? entry.dataField
              : typeof entry?.id === 'string'
                ? entry.id
                : ''
        }))
      : []
  }

  if (type === 'tableList') {
    normalized.tableStyleType = clampNumber(normalized.tableStyleType, 1, 3, 1)
    normalized.tableBorder = normalized.tableBorder === true
    normalized.tableStripe = normalized.tableStripe !== false
    normalized.tableShowHeader = normalized.tableShowHeader !== false
    normalized.tableShowIndex = normalized.tableShowIndex !== false
    normalized.headerFontSize = clampNumber(normalized.headerFontSize, 10, 25, 14)
    normalized.headerFontWeight = normalized.headerFontWeight === true
    normalized.headerFontColor = normalized.headerFontColor || '#303133'
    normalized.headerBackgroundColor = normalized.headerBackgroundColor || '#f3f6f9'
    normalized.headerAlign = ['left', 'center', 'right'].includes(normalized.headerAlign)
      ? normalized.headerAlign
      : 'center'
    normalized.rowFontSize = clampNumber(normalized.rowFontSize, 10, 25, 14)
    normalized.rowFontWeight = normalized.rowFontWeight === true
    normalized.rowFontColor = normalized.rowFontColor || '#606266'
    normalized.rowBackgroundColor = normalized.rowBackgroundColor || ''
    normalized.oddRowColor = normalized.oddRowColor || ''
    normalized.evenRowColor = normalized.evenRowColor || ''
    normalized.tableSize = ['large', 'default', 'small'].includes(normalized.tableSize)
      ? normalized.tableSize
      : 'small'
    normalized.tableMaxRows = clampNumber(normalized.tableMaxRows, 1, 100, 50)
    normalized.columns = Array.isArray(normalized.columns)
      ? normalized.columns.map((column: any, index: number) => ({
          key: typeof column?.key === 'string' && column.key ? column.key : `field${index + 1}`,
          label: typeof column?.label === 'string' ? column.label : `字段${index + 1}`,
          visible: column?.visible !== false,
          width: clampNumber(column?.width, 60, 500, 120),
          align: ['left', 'center', 'right'].includes(column?.align) ? column.align : 'left'
        }))
      : []
    normalized.rows = Array.isArray(normalized.rows) ? normalized.rows : []
  }

  if (['chart.bar', 'chart.line', 'chart.pie', 'chart.radar'].includes(type)) {
    const styleValues: Record<string, number[]> = {
      'chart.bar': [1, 2, 4, 5, 6, 7],
      'chart.line': [1, 2, 3, 4],
      'chart.pie': [1, 2],
      'chart.radar': [1, 2]
    }
    const requestedStyle = Number(normalized.styleType)
    normalized.styleType = styleValues[type].includes(requestedStyle) ? requestedStyle : 1
    normalized.categories = Array.isArray(normalized.categories)
      ? normalized.categories.map(String)
      : []
    normalized.values = Array.isArray(normalized.values)
      ? normalized.values.map((entry: any) => Number(entry) || 0)
      : []
    normalized.dataItems = Array.isArray(normalized.dataItems)
      ? normalized.dataItems
      : normalized.categories.map((name: string, index: number) => ({
          name,
          value: normalized.values[index] ?? 0
        }))
    normalized.chartTitle = typeof normalized.chartTitle === 'string' ? normalized.chartTitle : ''
    normalized.chartTitleColor = normalized.chartTitleColor || '#303133'
    normalized.chartTitleSize = clampNumber(normalized.chartTitleSize, 12, 30, 18)
    normalized.chartTitleWeight = normalized.chartTitleWeight !== false
    normalized.chartTitleAlign = ['left', 'center', 'right'].includes(normalized.chartTitleAlign)
      ? normalized.chartTitleAlign
      : 'center'
    normalized.chartSubtitle =
      typeof normalized.chartSubtitle === 'string' ? normalized.chartSubtitle : ''
    normalized.chartSubtitleColor = normalized.chartSubtitleColor || '#667085'
    normalized.chartSubtitleSize = clampNumber(normalized.chartSubtitleSize, 10, 24, 12)
    normalized.chartSubtitleWeight = normalized.chartSubtitleWeight === true
    normalized.barWidth = clampNumber(normalized.barWidth, 0, 100, 28)
    normalized.barRadius = clampNumber(normalized.barRadius, 0, 50, 3)
    normalized.barStack = normalized.barStack === true
    normalized.lineSmooth = normalized.lineSmooth !== false
    normalized.lineWidth = clampNumber(normalized.lineWidth, 1, 10, 2)
    normalized.lineSymbolSize = clampNumber(normalized.lineSymbolSize, 0, 30, 7)
    normalized.lineArea = normalized.lineArea === true
    normalized.xAxisShow = normalized.xAxisShow !== false
    normalized.yAxisShow = normalized.yAxisShow !== false
    normalized.xAxisLabelRotate = clampNumber(normalized.xAxisLabelRotate, -90, 90, 0)
    normalized.xAxisSplitLineShow = normalized.xAxisSplitLineShow === true
    normalized.yAxisSplitLineShow = normalized.yAxisSplitLineShow !== false
    normalized.xAxisInverse = normalized.xAxisInverse === true
    normalized.yAxisInverse = normalized.yAxisInverse === true
    normalized.valueShow = normalized.valueShow !== false
    normalized.valueSize = clampNumber(normalized.valueSize, 10, 30, 12)
    normalized.valueWeight = normalized.valueWeight === true
    normalized.tooltipShow = normalized.tooltipShow !== false
    normalized.tooltipSize = clampNumber(normalized.tooltipSize, 10, 30, 12)
    normalized.tooltipWeight = normalized.tooltipWeight === true
    normalized.marginLeft = clampNumber(normalized.marginLeft, 0, 400, 16)
    normalized.marginTop = clampNumber(normalized.marginTop, 0, 400, 48)
    normalized.marginRight = clampNumber(normalized.marginRight, 0, 400, 16)
    normalized.marginBottom = clampNumber(normalized.marginBottom, 0, 400, 28)
    normalized.centerX = clampNumber(normalized.centerX, 0, 100, 50)
    normalized.centerY = clampNumber(normalized.centerY, 0, 100, 50)
    normalized.legendShow =
      normalized.showLegend === false ? false : normalized.legendShow !== false
    normalized.legendSize = clampNumber(normalized.legendSize, 10, 30, 12)
    normalized.legendOrient = normalized.legendOrient === 'vertical' ? 'vertical' : 'horizontal'
    normalized.colors = Array.isArray(normalized.colors)
      ? normalized.colors.filter((color: any) => typeof color === 'string' && color)
      : []
    normalized.pieInnerRadius = clampNumber(normalized.pieInnerRadius, 0, 90, 0)
    normalized.pieOuterRadius = clampNumber(normalized.pieOuterRadius, 10, 95, 68)
    normalized.pieRose = normalized.pieRose === true
    normalized.pieLabelPosition = ['inside', 'outside', 'center'].includes(
      normalized.pieLabelPosition
    )
      ? normalized.pieLabelPosition
      : 'outside'
    normalized.pieShowPercent = normalized.pieShowPercent !== false
    normalized.radarMax = clampNumber(normalized.radarMax, 1, 1000000, 100)
    normalized.radarRadius = clampNumber(normalized.radarRadius, 20, 90, 62)
    normalized.radarShape = normalized.radarShape === 'circle' ? 'circle' : 'polygon'
    normalized.radarAreaOpacity = Math.max(
      0,
      Math.min(1, Number(normalized.radarAreaOpacity) || 0.25)
    )
    normalized.mappingConfig =
      Array.isArray(normalized.mappingConfig) && normalized.mappingConfig.length
        ? normalized.mappingConfig.map((entry: any) => ({
            key: typeof entry?.key === 'string' ? entry.key : entry?.field,
            field: typeof entry?.field === 'string' ? entry.field : entry?.key,
            value: typeof entry?.value === 'string' ? entry.value : ''
          }))
        : cloneDeep(portalMappingDefaults[type])
  }

  if (type === 'rankList') {
    normalized.styleType = clampNumber(normalized.styleType, 1, 4, 1)
    normalized.rankLimit = clampNumber(normalized.rankLimit, 1, 50, 10)
    normalized.showRankNumber = normalized.showRankNumber !== false
    normalized.showRankValue = normalized.showRankValue !== false
    normalized.valueColor = normalized.valueColor || '#172033'
    normalized.valueSuffix =
      typeof normalized.valueSuffix === 'string' ? normalized.valueSuffix : ''
    normalized.rankLabelField = normalized.rankLabelField || 'label'
    normalized.rankValueField = normalized.rankValueField || 'value'
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any, index: number) => ({
          label: typeof entry?.label === 'string' ? entry.label : `项目${index + 1}`,
          value: entry?.value ?? 0,
          url: typeof entry?.url === 'string' ? entry.url : ''
        }))
      : []
  }

  if (type === 'timeAxis') {
    normalized.styleType = clampNumber(normalized.styleType, 1, 2, 1)
    normalized.timelineLayout = ['alternate', 'left', 'right'].includes(normalized.timelineLayout)
      ? normalized.timelineLayout
      : 'alternate'
    normalized.timelineSort = normalized.timelineSort === 'desc' ? 'desc' : 'asc'
    normalized.timelineLimit = clampNumber(normalized.timelineLimit, 1, 200, 50)
    normalized.timelineShowTime = normalized.timelineShowTime !== false
    normalized.timelineShowIndex = normalized.timelineShowIndex === true
    normalized.timelineNodeColor = normalized.timelineNodeColor || '#3473ff'
    normalized.timelineLineColor = normalized.timelineLineColor || '#d5deeb'
    normalized.items = Array.isArray(normalized.items)
      ? normalized.items.map((entry: any, index: number) => ({
          timestamp: typeof entry?.timestamp === 'string' ? entry.timestamp : '',
          content: typeof entry?.content === 'string' ? entry.content : `节点${index + 1}`,
          url: typeof entry?.url === 'string' ? entry.url : ''
        }))
      : []
  }

  if (type === 'mapChart') {
    normalized.mapStyleType = ['region', 'scatter', 'heatmap', 'bar', 'rank'].includes(
      normalized.mapStyleType
    )
      ? normalized.mapStyleType
      : 'region'
    normalized.mapVisualMapType =
      normalized.mapVisualMapType === 'piecewise' ? 'piecewise' : 'continuous'
    normalized.mapDrillDown = normalized.mapDrillDown === true
    normalized.mapName = normalized.mapName || 'china'
    normalized.mapRoam = normalized.mapRoam !== false
    normalized.mapScale = Math.max(0.5, Math.min(3, Number(normalized.mapScale) || 1))
    normalized.mapBorderWidth = clampNumber(normalized.mapBorderWidth, 0, 10, 1)
    normalized.mapLabelShow = normalized.mapLabelShow === true
    normalized.mapLabelSize = clampNumber(normalized.mapLabelSize, 10, 24, 11)
    normalized.mapLabelWeight = normalized.mapLabelWeight === true
    normalized.mapCenterX = clampNumber(normalized.mapCenterX, 0, 100, 50)
    normalized.mapCenterY = clampNumber(normalized.mapCenterY, 0, 100, 52)
    normalized.mapPointSize = clampNumber(normalized.mapPointSize, 2, 30, 8)
    normalized.mapBlurSize = clampNumber(normalized.mapBlurSize, 0, 100, 20)
    normalized.mapPointOpacity = Math.max(0, Math.min(1, Number(normalized.mapPointOpacity) || 1))
    normalized.mapBarWidth = clampNumber(normalized.mapBarWidth, 1, 60, 10)
    normalized.mapRankLimit = clampNumber(normalized.mapRankLimit, 1, 50, 8)
    normalized.mapRankTitle =
      typeof normalized.mapRankTitle === 'string' ? normalized.mapRankTitle : '数据统计排名'
    normalized.mapRankTitleSize = clampNumber(normalized.mapRankTitleSize, 10, 30, 14)
    normalized.mapRankTitleColor = normalized.mapRankTitleColor || '#303133'
    normalized.mapRankGridTop = clampNumber(normalized.mapRankGridTop, 0, 200, 35)
    normalized.mapRankGridRight = clampNumber(normalized.mapRankGridRight, 0, 200, 16)
    normalized.mapRankGridBottom = clampNumber(normalized.mapRankGridBottom, 0, 400, 24)
    normalized.mapVisualMin = Number.isFinite(Number(normalized.mapVisualMin))
      ? Number(normalized.mapVisualMin)
      : 0
    normalized.mapVisualMax = Number.isFinite(Number(normalized.mapVisualMax))
      ? Number(normalized.mapVisualMax)
      : 200
    normalized.mapShowVisualMap = normalized.mapShowVisualMap !== false
    normalized.mapData = Array.isArray(normalized.mapData)
      ? normalized.mapData.map((entry: any) => ({
          name: typeof entry?.name === 'string' ? entry.name : '',
          value: Number(entry?.value) || 0,
          longitude: Number(entry?.longitude ?? entry?.long ?? entry?.lng) || undefined,
          latitude: Number(entry?.latitude ?? entry?.lat) || undefined,
          url: typeof entry?.url === 'string' ? entry.url : ''
        }))
      : []
  }

  if (type === 'customEcharts') {
    normalized.customOption =
      typeof normalized.customOption === 'object' && normalized.customOption
        ? normalized.customOption
        : {}
  }

  if (type === 'card') {
    normalized.titleFontSize = clampNumber(normalized.titleFontSize, 12, 25, 14)
    normalized.titleFontWeight = normalized.titleFontWeight === true
    normalized.titleFontColor = normalized.titleFontColor || normalized.titleColor || '#303133'
    normalized.titleAlign = ['left', 'center', 'right'].includes(normalized.titleAlign)
      ? normalized.titleAlign
      : 'left'
    normalized.titleBackgroundColor = normalized.titleBackgroundColor || ''
    normalized.titleIcon = normalized.titleIcon || 'ep:postcard'
    normalized.titleIconColor = normalized.titleIconColor || normalized.headerColor || '#606266'
    normalized.actionText = normalized.actionText || ''
    normalized.actionUrl = normalized.actionUrl || ''
    normalized.actionTarget = normalized.actionTarget === '_blank' ? '_blank' : '_self'
    normalized.showHeader = normalized.showHeader !== false
    normalized.children = normalizeNestedItems(normalized.children)
  }

  if (type === 'tabs') {
    normalized.styleType = normalized.styleType === 'card' ? 'card' : 'default'
    normalized.tabPosition = ['top', 'bottom', 'left', 'right'].includes(normalized.tabPosition)
      ? normalized.tabPosition
      : 'top'
    normalized.tabs = Array.isArray(normalized.tabs)
      ? normalized.tabs.map((tab: any, tabIndex: number) => ({
          id: typeof tab?.id === 'string' && tab.id ? tab.id : `tab-${tabIndex + 1}`,
          label:
            typeof tab?.label === 'string' && tab.label
              ? tab.label
              : typeof tab?.title === 'string' && tab.title
                ? tab.title
                : `标签 ${tabIndex + 1}`,
          icon: typeof tab?.icon === 'string' ? tab.icon : '',
          items: normalizeNestedItems(tab?.items)
        }))
      : []
    if (!normalized.tabs.length) {
      normalized.tabs = cloneDeep(getComponentDefinition('tabs').defaultProps.tabs)
    }
    if (!normalized.tabs.some((tab: any) => tab.id === normalized.active)) {
      normalized.active = normalized.tabs[0].id
    }
  }

  return normalized
}

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback
}

const defaultTodoItems = () => cloneDeep(todoSummaryItems)

export const parsePortalConfig = (content?: string): PortalConfig => {
  if (!content) return createDefaultPortalConfig()
  try {
    const value = JSON.parse(content) as Partial<PortalConfig>
    const defaults = createDefaultPortalConfig()
    const items = Array.isArray(value.items)
      ? (value.items.map(normalizeItem).filter(Boolean) as PortalItem[])
      : []
    return {
      ...defaults,
      ...value,
      schemaVersion: PORTAL_SCHEMA_VERSION,
      columns: 24,
      rowHeight: Number.isFinite(value.rowHeight)
        ? Math.max(1, Math.min(100, Number(value.rowHeight)))
        : defaults.rowHeight,
      gap: Number.isFinite(value.gap) ? Math.max(0, Math.min(64, Number(value.gap))) : defaults.gap,
      items
    }
  } catch {
    return createDefaultPortalConfig()
  }
}

export const stringifyPortalConfig = (config: PortalConfig) =>
  JSON.stringify({ ...config, schemaVersion: PORTAL_SCHEMA_VERSION, columns: 24 }, null, 2)

export const countPortalItems = (items: PortalItem[]): number =>
  items.reduce((count, item) => {
    const children = Array.isArray(item.props?.children) ? item.props.children : []
    const tabs = Array.isArray(item.props?.tabs) ? item.props.tabs : []
    const tabItems = tabs.flatMap((tab: any) => (Array.isArray(tab.items) ? tab.items : []))
    return count + 1 + countPortalItems([...children, ...tabItems])
  }, 0)
