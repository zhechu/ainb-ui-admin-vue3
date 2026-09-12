<template>
  <aside class="portal-properties">
    <div class="portal-panel-title">属性</div>
    <el-empty v-if="!item" description="选择控件后编辑属性" :image-size="70" />
    <el-form v-else label-position="top" size="small">
      <el-form-item label="控件类型">
        <el-input :model-value="getComponentDefinition(item.type).label" disabled />
      </el-form-item>

      <el-radio-group
        :model-value="activeSection"
        class="portal-properties__section-nav"
        size="small"
        @change="handleSectionChange"
      >
        <el-radio-button label="layout">
          <Icon icon="ep:grid" />
          <span>布局</span>
        </el-radio-button>
        <el-radio-button label="component">
          <Icon icon="ep:setting" />
          <span>组件</span>
        </el-radio-button>
        <el-radio-button v-if="dataSectionVisible" label="data">
          <Icon icon="ep:coin" />
          <span>数据</span>
        </el-radio-button>
      </el-radio-group>

      <el-collapse
        ref="collapseRef"
        v-model="activeSection"
        accordion
        class="portal-properties__collapse"
      >
        <el-collapse-item name="layout">
          <template #title>基础与布局</template>
          <el-divider content-position="left">布局</el-divider>
          <el-row :gutter="8">
            <el-col :span="12">
              <el-form-item label="横坐标">
                <el-input-number
                  :model-value="item.x"
                  :min="0"
                  :max="23"
                  controls-position="right"
                  class="w-full"
                  @update:model-value="updateField('x', $event)"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="纵坐标">
                <el-input-number
                  :model-value="item.y"
                  :min="0"
                  :max="10000"
                  controls-position="right"
                  class="w-full"
                  @update:model-value="updateField('y', $event)"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="宽度">
                <el-input-number
                  :model-value="item.w"
                  :min="1"
                  :max="24 - item.x"
                  controls-position="right"
                  class="w-full"
                  @update:model-value="updateField('w', $event)"
                />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="高度">
                <el-input-number
                  :model-value="item.h"
                  :min="1"
                  :max="1000"
                  controls-position="right"
                  class="w-full"
                  @update:model-value="updateField('h', $event)"
                />
              </el-form-item>
            </el-col>
          </el-row>
        </el-collapse-item>

        <el-collapse-item name="component">
          <template #title>组件设置</template>
          <PortalCardSettings
            v-if="item.type === 'card' || hasCardSettings"
            :model-value="item.props"
            @update:model-value="updateProps"
          />

          <template v-if="isLayoutItem">
            <template v-if="item.type === 'tabs'">
              <el-form-item label="标题">
                <el-input
                  :model-value="item.props.title"
                  @update:model-value="updateProp('title', $event)"
                />
              </el-form-item>
              <el-form-item label="风格类型">
                <el-radio-group
                  :model-value="item.props.styleType || 'default'"
                  size="small"
                  @change="updateProp('styleType', $event)"
                >
                  <el-radio-button label="default">默认</el-radio-button>
                  <el-radio-button label="card">卡片</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="选项卡位置">
                <el-radio-group
                  :model-value="item.props.tabPosition || 'top'"
                  size="small"
                  @change="updateProp('tabPosition', $event)"
                >
                  <el-radio-button
                    v-for="option in tabPositionOptions"
                    :key="option.value"
                    :label="option.value"
                    >{{ option.label }}</el-radio-button
                  >
                </el-radio-group>
              </el-form-item>
              <div class="portal-properties__section-label">标签页配置</div>
              <div class="portal-properties__tab-list">
                <div
                  v-for="(tab, index) in item.props.tabs || []"
                  :key="tab.id"
                  class="portal-properties__tab-item"
                >
                  <div class="portal-properties__tab-toolbar">
                    <el-button
                      text
                      circle
                      size="small"
                      :title="`设为当前标签：${tab.label}`"
                      @click="setActiveTab(tab.id)"
                    >
                      <Icon
                        :icon="item.props.active === tab.id ? 'ep:check' : 'ep:more-filled'"
                        :class="{ 'is-active': item.props.active === tab.id }"
                      />
                    </el-button>
                    <span>标签页 {{ Number(index) + 1 }}</span>
                    <span class="portal-properties__tab-toolbar-actions">
                      <el-button
                        text
                        circle
                        size="small"
                        title="上移"
                        :disabled="index === 0"
                        @click="moveTab(Number(index), -1)"
                        ><Icon icon="ep:arrow-up"
                      /></el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        title="下移"
                        :disabled="Number(index) === (item.props.tabs || []).length - 1"
                        @click="moveTab(Number(index), 1)"
                        ><Icon icon="ep:arrow-down"
                      /></el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        title="删除标签页"
                        :disabled="(item.props.tabs || []).length <= 1"
                        @click="removeTab(Number(index))"
                        ><Icon icon="ep:delete"
                      /></el-button>
                    </span>
                  </div>
                  <el-input
                    :model-value="tab.label"
                    maxlength="30"
                    placeholder="标签名称"
                    @update:model-value="updateTab(Number(index), 'label', String($event ?? ''))"
                  />
                  <IconSelect
                    :model-value="tab.icon || ''"
                    clearable
                    @update:model-value="updateTab(Number(index), 'icon', String($event ?? ''))"
                  />
                </div>
              </div>
              <el-button class="portal-properties__add-tab" plain type="primary" @click="addTab"
                ><Icon icon="ep:plus" />添加标签页</el-button
              >
            </template>
            <div class="portal-properties__nested-title">添加内容控件</div>
            <div class="portal-properties__add-row">
              <el-select v-model="nestedType" class="flex-1" placeholder="选择控件">
                <el-option
                  v-for="definition in nestedDefinitions"
                  :key="definition.type"
                  :label="definition.label"
                  :value="definition.type"
                />
              </el-select>
              <el-button type="primary" :disabled="!nestedType" @click="addNestedItem"
                ><Icon icon="ep:plus"
              /></el-button>
            </div>
            <el-input
              v-model="nestedText"
              type="textarea"
              :rows="6"
              placeholder="也可以直接编辑嵌套内容 JSON"
              @blur="syncNestedJson"
            />
          </template>

          <template v-if="portalDataSourceItem && !portalDataItem">
            <PortalDataSourceFields
              :type="item.type"
              :model-value="item.props"
              @update:model-value="updateProps"
            />
            <el-form-item
              v-if="staticJsonField && item.props.dataMode !== 'dynamic'"
              :label="staticJsonLabel"
            >
              <el-input
                v-model="jsonText"
                type="textarea"
                :rows="9"
                @blur="syncJson(staticJsonField)"
              />
            </el-form-item>
          </template>

          <template v-if="item.type === 'text'">
            <el-divider content-position="left">文本设置</el-divider>
            <el-form-item label="文本类型">
              <el-radio-group
                :model-value="item.props.contentType || 'text'"
                size="small"
                @change="updateProp('contentType', $event)"
              >
                <el-radio-button label="text">普通文本</el-radio-button>
                <el-radio-button label="rich">富文本</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="item.props.dataMode !== 'dynamic'" label="文本内容">
              <el-input
                :model-value="item.props.content"
                type="textarea"
                :rows="item.props.contentType === 'rich' ? 8 : 5"
                :placeholder="
                  item.props.contentType === 'rich' ? '请输入 HTML 内容' : '请输入文本内容'
                "
                @update:model-value="updateProp('content', $event)"
              />
            </el-form-item>
            <el-form-item label="文本位置">
              <el-radio-group
                :model-value="item.props.align || 'left'"
                size="small"
                @change="updateProp('align', $event)"
              >
                <el-radio-button
                  v-for="option in alignOptions"
                  :key="option.value"
                  :label="option.value"
                >
                  {{ option.label }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-row :gutter="8"
              ><el-col :span="12"
                ><el-form-item label="字号"
                  ><el-input-number
                    :model-value="item.props.fontSize || 14"
                    :min="10"
                    :max="48"
                    controls-position="right"
                    class="w-full"
                    @update:model-value="updateProp('fontSize', $event)" /></el-form-item></el-col
              ><el-col :span="12"
                ><el-form-item label="文字颜色"
                  ><el-color-picker
                    :model-value="item.props.color || '#1f2937'"
                    @update:model-value="updateProp('color', $event)" /></el-form-item></el-col
            ></el-row>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="文字加粗">
                  <el-switch
                    :model-value="item.props.fontWeight === true"
                    @change="updateProp('fontWeight', $event)"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="文字斜体">
                  <el-switch
                    :model-value="item.props.fontStyle === true"
                    @change="updateProp('fontStyle', $event)"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="文字下划线">
              <el-switch
                :model-value="item.props.underline === true"
                @change="updateProp('underline', $event)"
              />
            </el-form-item>
            <el-form-item label="文本滚动">
              <el-switch
                :model-value="item.props.textAutoplay === true"
                :disabled="item.props.contentType === 'rich'"
                @change="updateProp('textAutoplay', $event)"
              />
            </el-form-item>
            <template v-if="item.props.textAutoplay && item.props.contentType !== 'rich'">
              <el-form-item label="滚动方向">
                <el-radio-group
                  :model-value="item.props.textAutoplayMode || 'left'"
                  size="small"
                  @change="updateProp('textAutoplayMode', $event)"
                >
                  <el-radio-button label="left">横向</el-radio-button>
                  <el-radio-button label="up">纵向</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="滚动速度">
                <el-input-number
                  :model-value="item.props.textAutoplaySpeed || 20"
                  :min="10"
                  :max="100"
                  controls-position="right"
                  class="w-full"
                  @update:model-value="updateProp('textAutoplaySpeed', $event)"
                />
              </el-form-item>
            </template>
            <el-form-item label="文本背景色">
              <el-color-picker
                :model-value="item.props.background || '#ffffff'"
                show-alpha
                @update:model-value="updateProp('background', $event)"
              />
            </el-form-item>
            <el-form-item v-if="item.props.dataMode !== 'dynamic'" label="文本链接">
              <el-input
                :model-value="item.props.link"
                placeholder="支持站内路径或 http(s) 地址"
                @update:model-value="updateProp('link', $event)"
              />
            </el-form-item>
            <el-form-item v-if="item.props.link" label="打开方式">
              <el-radio-group
                :model-value="item.props.linkTarget || '_self'"
                size="small"
                @change="updateProp('linkTarget', $event)"
              >
                <el-radio-button label="_self">当前窗口</el-radio-button>
                <el-radio-button label="_blank">新窗口</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </template>

          <template v-if="item.type === 'image'">
            <el-divider content-position="left">图片设置</el-divider>
            <el-form-item v-if="item.props.dataMode !== 'dynamic'" label="图片来源">
              <el-radio-group
                :model-value="item.props.sourceType || 'url'"
                size="small"
                @change="changeImageSource"
              >
                <el-radio-button label="upload">上传图片</el-radio-button>
                <el-radio-button label="url">图片地址</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="item.props.dataMode !== 'dynamic' && item.props.sourceType === 'upload'"
              label="上传图片"
            >
              <UploadImg
                :model-value="item.props.src || ''"
                height="100px"
                width="100%"
                @update:model-value="updateProp('src', $event)"
              />
            </el-form-item>
            <el-form-item v-else-if="item.props.dataMode !== 'dynamic'" label="图片地址">
              <el-input
                :model-value="item.props.src"
                placeholder="请输入 http(s) 图片地址"
                @update:model-value="updateProp('src', $event)"
              />
            </el-form-item>
            <el-form-item label="图片说明">
              <el-input
                :model-value="item.props.caption"
                @update:model-value="updateProp('caption', $event)"
              />
            </el-form-item>
            <el-form-item label="链接地址">
              <el-input
                :model-value="item.props.link"
                placeholder="支持站内路径或 http(s) 地址"
                @update:model-value="updateProp('link', $event)"
              />
            </el-form-item>
            <el-form-item v-if="item.props.link" label="打开方式">
              <el-radio-group
                :model-value="item.props.linkTarget || '_self'"
                size="small"
                @change="updateProp('linkTarget', $event)"
              >
                <el-radio-button label="_self">当前窗口</el-radio-button>
                <el-radio-button label="_blank">新窗口</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="替代文本">
              <el-input
                :model-value="item.props.alt"
                @update:model-value="updateProp('alt', $event)"
              />
            </el-form-item>
            <el-form-item label="填充方式">
              <el-select
                :model-value="item.props.objectFit || 'cover'"
                class="w-full"
                @change="updateProp('objectFit', $event)"
              >
                <el-option label="覆盖" value="cover" />
                <el-option label="包含" value="contain" />
                <el-option label="拉伸" value="fill" />
              </el-select>
            </el-form-item>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="说明字号">
                  <el-input-number
                    :model-value="item.props.captionFontSize || 13"
                    :min="10"
                    :max="25"
                    controls-position="right"
                    class="w-full"
                    @update:model-value="updateProp('captionFontSize', $event)"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="说明加粗">
                  <el-switch
                    :model-value="item.props.captionFontWeight === true"
                    @change="updateProp('captionFontWeight', $event)"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="说明颜色">
              <el-color-picker
                :model-value="item.props.captionColor || '#ffffff'"
                show-alpha
                @update:model-value="updateProp('captionColor', $event)"
              />
            </el-form-item>
            <el-form-item label="说明位置">
              <el-radio-group
                :model-value="item.props.captionAlign || 'left'"
                size="small"
                @change="updateProp('captionAlign', $event)"
              >
                <el-radio-button
                  v-for="option in alignOptions"
                  :key="option.value"
                  :label="option.value"
                >
                  {{ option.label }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="说明背景色">
              <el-color-picker
                :model-value="item.props.captionBackground || 'rgb(0 0 0 / 48%)'"
                show-alpha
                @update:model-value="updateProp('captionBackground', $event)"
              />
            </el-form-item>
          </template>

          <template v-if="item.type === 'carousel'">
            <el-divider content-position="left">轮播设置</el-divider>
            <el-form-item label="轮播方向">
              <el-radio-group
                :model-value="item.props.direction || 'horizontal'"
                size="small"
                @change="updateProp('direction', $event)"
              >
                <el-radio-button label="horizontal">横向</el-radio-button>
                <el-radio-button label="vertical">纵向</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-row :gutter="8"
              ><el-col :span="12"
                ><el-form-item label="间隔（毫秒）"
                  ><el-input-number
                    :model-value="item.props.interval || 4000"
                    :min="1000"
                    :max="60000"
                    controls-position="right"
                    class="w-full"
                    @update:model-value="updateProp('interval', $event)" /></el-form-item></el-col
              ><el-col :span="12"
                ><el-form-item label="自动播放"
                  ><el-switch
                    :model-value="item.props.autoplay !== false"
                    @change="updateProp('autoplay', $event)" /></el-form-item></el-col
            ></el-row>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="指示器">
                  <el-select
                    :model-value="item.props.indicator || 'outside'"
                    class="w-full"
                    @change="updateProp('indicator', $event)"
                  >
                    <el-option label="显示" value="outside" />
                    <el-option label="隐藏" value="none" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="箭头显示">
                  <el-select
                    :model-value="item.props.arrow || 'hover'"
                    class="w-full"
                    @change="updateProp('arrow', $event)"
                  >
                    <el-option label="悬停显示" value="hover" />
                    <el-option label="始终显示" value="always" />
                    <el-option label="不显示" value="never" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="填充方式">
              <el-select
                :model-value="item.props.objectFit || 'cover'"
                class="w-full"
                @change="updateProp('objectFit', $event)"
              >
                <el-option label="覆盖" value="cover" />
                <el-option label="包含" value="contain" />
                <el-option label="拉伸" value="fill" />
              </el-select>
            </el-form-item>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="说明字号">
                  <el-input-number
                    :model-value="item.props.captionFontSize || 13"
                    :min="10"
                    :max="25"
                    controls-position="right"
                    class="w-full"
                    @update:model-value="updateProp('captionFontSize', $event)"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="说明加粗">
                  <el-switch
                    :model-value="item.props.captionFontWeight === true"
                    @change="updateProp('captionFontWeight', $event)"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="说明颜色">
              <el-color-picker
                :model-value="item.props.captionColor || '#ffffff'"
                show-alpha
                @update:model-value="updateProp('captionColor', $event)"
              />
            </el-form-item>
            <el-form-item label="说明位置">
              <el-radio-group
                :model-value="item.props.captionAlign || 'left'"
                size="small"
                @change="updateProp('captionAlign', $event)"
              >
                <el-radio-button
                  v-for="option in alignOptions"
                  :key="option.value"
                  :label="option.value"
                >
                  {{ option.label }}
                </el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="说明背景色">
              <el-color-picker
                :model-value="item.props.captionBackground || 'rgb(0 0 0 / 48%)'"
                show-alpha
                @update:model-value="updateProp('captionBackground', $event)"
              />
            </el-form-item>
            <template v-if="item.props.dataMode !== 'dynamic'">
              <div class="portal-properties__section-label">轮播项</div>
              <div class="portal-properties__media-list">
                <div
                  v-for="(image, index) in item.props.images || []"
                  :key="`carousel-${index}`"
                  class="portal-properties__media-item"
                >
                  <div class="portal-properties__media-toolbar">
                    <span>第 {{ Number(index) + 1 }} 项</span>
                    <div>
                      <el-button
                        text
                        circle
                        size="small"
                        title="上移"
                        :disabled="index === 0"
                        @click="moveImage(Number(index), -1)"
                      >
                        <Icon icon="ep:arrow-up" />
                      </el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        title="下移"
                        :disabled="Number(index) === item.props.images.length - 1"
                        @click="moveImage(Number(index), 1)"
                      >
                        <Icon icon="ep:arrow-down" />
                      </el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        title="删除"
                        @click="removeImage(Number(index))"
                      >
                        <Icon icon="ep:delete" />
                      </el-button>
                    </div>
                  </div>
                  <el-radio-group
                    :model-value="image.sourceType || 'url'"
                    size="small"
                    @change="updateImage(Number(index), 'sourceType', $event)"
                  >
                    <el-radio-button label="upload">上传图片</el-radio-button>
                    <el-radio-button label="url">图片地址</el-radio-button>
                  </el-radio-group>
                  <UploadImg
                    v-if="image.sourceType === 'upload'"
                    :model-value="image.src || ''"
                    height="80px"
                    width="100%"
                    @update:model-value="updateImage(Number(index), 'src', $event)"
                  />
                  <el-input
                    v-else
                    :model-value="image.src"
                    class="portal-properties__media-input"
                    placeholder="请输入 http(s) 图片地址"
                    @update:model-value="updateImage(Number(index), 'src', $event)"
                  />
                  <el-input
                    :model-value="image.title"
                    class="portal-properties__media-input"
                    placeholder="说明文字"
                    @update:model-value="updateImage(Number(index), 'title', $event)"
                  />
                  <el-input
                    :model-value="image.link"
                    class="portal-properties__media-input"
                    placeholder="跳转链接，可选"
                    @update:model-value="updateImage(Number(index), 'link', $event)"
                  />
                  <el-radio-group
                    v-if="image.link"
                    :model-value="image.target || '_self'"
                    class="portal-properties__media-input"
                    size="small"
                    @change="updateImage(Number(index), 'target', $event)"
                  >
                    <el-radio-button label="_self">当前窗口</el-radio-button>
                    <el-radio-button label="_blank">新窗口</el-radio-button>
                  </el-radio-group>
                </div>
              </div>
              <el-button class="portal-properties__add-tab" plain type="primary" @click="addImage">
                <Icon icon="ep:plus" />添加轮播项
              </el-button>
            </template>
          </template>

          <template v-if="item.type === 'video'">
            <el-divider content-position="left">视频设置</el-divider>
            <el-form-item v-if="item.props.dataMode !== 'dynamic'" label="视频来源">
              <el-radio-group
                :model-value="item.props.sourceType || 'url'"
                size="small"
                @change="changeVideoSource"
              >
                <el-radio-button label="upload">上传视频</el-radio-button>
                <el-radio-button label="url">视频地址</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="item.props.dataMode !== 'dynamic' && item.props.sourceType === 'upload'"
              label="上传视频"
            >
              <UploadFile
                :model-value="item.props.src || ''"
                :limit="1"
                :file-type="['mp4', 'webm', 'ogg']"
                :file-size="100"
                :is-show-tip="false"
                @update:model-value="updateProp('src', $event)"
              />
            </el-form-item>
            <el-form-item v-else-if="item.props.dataMode !== 'dynamic'" label="视频地址">
              <el-input
                :model-value="item.props.src"
                placeholder="请输入 http(s) 视频地址"
                @update:model-value="updateProp('src', $event)"
              />
            </el-form-item>
            <el-form-item v-if="item.props.dataMode !== 'dynamic'" label="封面来源">
              <el-radio-group
                :model-value="item.props.posterSourceType || 'url'"
                size="small"
                @change="updateProp('posterSourceType', $event)"
              >
                <el-radio-button label="upload">上传封面</el-radio-button>
                <el-radio-button label="url">封面地址</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item
              v-if="item.props.dataMode !== 'dynamic' && item.props.posterSourceType === 'upload'"
              label="上传封面"
            >
              <UploadImg
                :model-value="item.props.poster || ''"
                height="80px"
                width="100%"
                @update:model-value="updateProp('poster', $event)"
              />
            </el-form-item>
            <el-form-item v-else-if="item.props.dataMode !== 'dynamic'" label="封面地址">
              <el-input
                :model-value="item.props.poster"
                placeholder="请输入 http(s) 图片地址"
                @update:model-value="updateProp('poster', $event)"
              />
            </el-form-item>
            <el-row :gutter="8"
              ><el-col :span="12"
                ><el-form-item label="自动播放"
                  ><el-switch
                    :model-value="item.props.autoplay === true"
                    @change="updateProp('autoplay', $event)" /></el-form-item></el-col
              ><el-col :span="12"
                ><el-form-item label="显示控制栏"
                  ><el-switch
                    :model-value="item.props.controls !== false"
                    @change="updateProp('controls', $event)" /></el-form-item></el-col
            ></el-row>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="循环播放">
                  <el-switch
                    :model-value="item.props.loop === true"
                    @change="updateProp('loop', $event)"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="静音播放">
                  <el-switch
                    :model-value="item.props.muted === true"
                    @change="updateProp('muted', $event)"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="播放速度">
              <el-select
                :model-value="item.props.playbackRate || 1"
                class="w-full"
                @change="updateProp('playbackRate', $event)"
              >
                <el-option label="0.5 倍" :value="0.5" />
                <el-option label="正常" :value="1" />
                <el-option label="1.5 倍" :value="1.5" />
                <el-option label="2 倍" :value="2" />
              </el-select>
            </el-form-item>
          </template>

          <template v-if="item.type === 'iframe'">
            <el-divider content-position="left">iframe 设置</el-divider>
            <el-form-item v-if="item.props.dataMode !== 'dynamic'" label="网页地址"
              ><el-input
                :model-value="item.props.url"
                placeholder="请输入 http(s) 网页地址"
                @update:model-value="updateProp('url', $event)"
            /></el-form-item>
            <el-form-item label="网页标题"
              ><el-input
                :model-value="item.props.frameTitle"
                @update:model-value="updateProp('frameTitle', $event)"
            /></el-form-item>
            <el-form-item label="允许能力">
              <el-input
                :model-value="item.props.allow"
                placeholder="例如 fullscreen"
                @update:model-value="updateProp('allow', $event)"
              />
            </el-form-item>
          </template>

          <template v-if="item.type === 'commonFunc'">
            <el-divider content-position="left">常用功能设置</el-divider>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="每行数量">
                  <el-input-number
                    :model-value="item.props.columns || 4"
                    :min="1"
                    :max="8"
                    controls-position="right"
                    class="w-full"
                    @update:model-value="updateProp('columns', $event)"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="显示边框">
                  <el-switch
                    :model-value="item.props.showBorder !== false"
                    @change="updateProp('showBorder', $event)"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="图标位置">
              <el-radio-group
                :model-value="item.props.iconPosition || 'top'"
                size="small"
                @change="updateProp('iconPosition', $event)"
              >
                <el-radio-button label="top">上下布局</el-radio-button>
                <el-radio-button label="left">左右布局</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-row :gutter="8">
              <el-col :span="12">
                <el-form-item label="名称大小">
                  <el-input-number
                    :model-value="item.props.labelFontSize || 13"
                    :min="10"
                    :max="25"
                    controls-position="right"
                    class="w-full"
                    @update:model-value="updateProp('labelFontSize', $event)"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="名称加粗">
                  <el-switch
                    :model-value="item.props.labelFontWeight === true"
                    @change="updateProp('labelFontWeight', $event)"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="名称颜色">
              <el-color-picker
                :model-value="item.props.labelFontColor || '#475467'"
                show-alpha
                @update:model-value="updateProp('labelFontColor', $event)"
              />
            </el-form-item>
            <template v-if="item.props.dataMode !== 'dynamic'">
              <div class="portal-properties__section-label">功能项</div>
              <div class="portal-properties__function-list">
                <div
                  v-for="(entry, index) in item.props.items || []"
                  :key="`function-${index}`"
                  class="portal-properties__function-item"
                >
                  <div class="portal-properties__media-toolbar">
                    <span>第 {{ Number(index) + 1 }} 项</span>
                    <div>
                      <el-button
                        text
                        circle
                        size="small"
                        title="上移"
                        :disabled="index === 0"
                        @click="moveFunction(Number(index), -1)"
                      >
                        <Icon icon="ep:arrow-up" />
                      </el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        title="下移"
                        :disabled="Number(index) === item.props.items.length - 1"
                        @click="moveFunction(Number(index), 1)"
                      >
                        <Icon icon="ep:arrow-down" />
                      </el-button>
                      <el-button
                        text
                        circle
                        size="small"
                        title="删除"
                        @click="removeFunction(Number(index))"
                      >
                        <Icon icon="ep:delete" />
                      </el-button>
                    </div>
                  </div>
                  <el-input
                    :model-value="entry.label"
                    placeholder="功能名称"
                    @update:model-value="updateFunction(Number(index), 'label', $event)"
                  />
                  <IconSelect
                    :model-value="entry.icon || ''"
                    clearable
                    @update:model-value="updateFunction(Number(index), 'icon', $event)"
                  />
                  <el-color-picker
                    :model-value="entry.color || '#3473ff'"
                    show-alpha
                    @update:model-value="updateFunction(Number(index), 'color', $event)"
                  />
                  <el-input
                    :model-value="entry.url"
                    class="portal-properties__media-input"
                    placeholder="跳转路径或链接"
                    @update:model-value="updateFunction(Number(index), 'url', $event)"
                  />
                  <el-radio-group
                    :model-value="entry.target || '_self'"
                    size="small"
                    @change="updateFunction(Number(index), 'target', $event)"
                  >
                    <el-radio-button label="_self">当前窗口</el-radio-button>
                    <el-radio-button label="_blank">新窗口</el-radio-button>
                  </el-radio-group>
                </div>
              </div>
              <el-button
                class="portal-properties__add-tab"
                plain
                type="primary"
                @click="addFunction"
              >
                <Icon icon="ep:plus" />添加功能
              </el-button>
            </template>
          </template>
        </el-collapse-item>

        <el-collapse-item name="data">
          <template #title>数据设置</template>
          <template v-if="systemItem">
            <el-divider content-position="left">数据设置</el-divider>
            <el-form-item label="标题"
              ><el-input
                :model-value="item.props.title"
                @update:model-value="updateProp('title', $event)"
            /></el-form-item>
          </template>

          <template v-if="item.type === 'myTodo'">
            <PortalTodoSettings
              :model-value="item.props"
              mode="summary"
              @update:model-value="updateProps"
            />
          </template>

          <template v-if="item.type === 'todoList' || item.type === 'doingList'">
            <PortalTodoSettings
              :model-value="item.props"
              mode="list"
              @update:model-value="updateProps"
            />
          </template>

          <template v-if="item.type === 'notice'">
            <PortalNoticeSettings :model-value="item.props" @update:model-value="updateProps" />
          </template>

          <PortalChartSettings
            v-if="portalDataItem"
            :type="item.type"
            :model-value="item.props"
            @update:model-value="updateProps"
          />
        </el-collapse-item>
      </el-collapse>

      <div class="portal-properties__actions">
        <el-button circle title="复制控件" @click="emit('duplicate', item.id)">
          <Icon icon="ep:copy-document" />
        </el-button>
        <el-button circle title="删除控件" @click="emit('remove', item.id)">
          <Icon icon="ep:delete" />
        </el-button>
      </div>
    </el-form>
  </aside>
</template>

<script lang="ts" setup>
import type { PortalItem } from '@/api/infra/portal'
import {
  PORTAL_DATA_SOURCE_TYPES,
  getComponentDefinition,
  getComponentsByGroup
} from '@/components/Portal/helper/componentRegistry'
import PortalCardSettings from '@/components/Portal/Designer/PortalCardSettings.vue'
import PortalChartSettings from '@/components/Portal/Designer/PortalChartSettings.vue'
import PortalDataSourceFields from '@/components/Portal/Designer/PortalDataSourceFields.vue'
import PortalNoticeSettings from '@/components/Portal/Designer/PortalNoticeSettings.vue'
import PortalTodoSettings from '@/components/Portal/Designer/PortalTodoSettings.vue'
import { UploadFile, UploadImg } from '@/components/UploadFile'
import { cloneDeep } from 'lodash-es'

defineOptions({ name: 'PortalPropertyPanel' })

const props = defineProps<{ item?: PortalItem }>()
const emit = defineEmits<{
  update: [item: PortalItem]
  addNested: [type: string, parentId: string, tabId?: string]
  remove: [id: string]
  duplicate: [id: string]
}>()
const message = useMessage()
const jsonText = ref('[]')
const nestedText = ref('[]')
const nestedType = ref('text')
const activeSection = ref('component')
const alignOptions = [
  { label: '左', value: 'left' },
  { label: '中', value: 'center' },
  { label: '右', value: 'right' }
]
const tabPositionOptions = [
  { label: '顶部', value: 'top' },
  { label: '底部', value: 'bottom' },
  { label: '左侧', value: 'left' },
  { label: '右侧', value: 'right' }
]

const layoutTypes = ['card', 'tabs']
const systemTypes = ['email']
const cardTypes = [
  'commonFunc',
  'text',
  'image',
  'carousel',
  'video',
  'iframe',
  'myTodo',
  'todoList',
  'doingList',
  'notice',
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
const isLayoutItem = computed(() => !!props.item && layoutTypes.includes(props.item.type))
const hasCardSettings = computed(() => !!props.item && cardTypes.includes(props.item.type))
const systemItem = computed(() => !!props.item && systemTypes.includes(props.item.type))
const portalDataItem = computed(
  () =>
    !!props.item &&
    [
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
    ].includes(props.item.type)
)
const portalDataSourceItem = computed(
  () =>
    !!props.item &&
    PORTAL_DATA_SOURCE_TYPES.includes(props.item.type as (typeof PORTAL_DATA_SOURCE_TYPES)[number])
)
const dataSectionVisible = computed(
  () =>
    !!props.item &&
    (systemItem.value ||
      portalDataItem.value ||
      ['myTodo', 'todoList', 'doingList', 'notice'].includes(props.item.type))
)
const staticJsonFields: Record<string, string> = {
  carousel: 'images',
  commonFunc: 'items',
  myTodo: 'items',
  todoList: 'items',
  doingList: 'items',
  notice: 'items',
  email: 'items'
}
const staticJsonField = computed(() => (props.item ? staticJsonFields[props.item.type] : undefined))
const staticJsonLabel = computed(() => {
  const labels: Record<string, string> = {
    carousel: '轮播数据 JSON',
    commonFunc: '功能数据 JSON',
    myTodo: '事项数据 JSON',
    todoList: '待办数据 JSON',
    doingList: '在办数据 JSON',
    notice: '公告数据 JSON',
    email: '邮件数据 JSON'
  }
  return props.item ? labels[props.item.type] || '静态数据 JSON' : '静态数据 JSON'
})
const nestedDefinitions = computed(() => [
  ...getComponentsByGroup('layout'),
  ...getComponentsByGroup('basic'),
  ...getComponentsByGroup('system'),
  ...getComponentsByGroup('chart')
])
const resetText = (item?: PortalItem) => {
  const value = item?.props || {}
  jsonText.value = JSON.stringify(value.items || value.images || value.rows || [], null, 2)
  const activeTab =
    (value.tabs || []).find((tab: any) => tab.id === value.active) || value.tabs?.[0]
  nestedText.value = JSON.stringify(
    item?.type === 'card' ? value.children || [] : activeTab?.items || [],
    null,
    2
  )
}

watch(
  () => props.item,
  () => resetText(props.item),
  { immediate: true, deep: true }
)

watch(
  () => props.item?.id,
  () => {
    activeSection.value = portalDataItem.value ? 'data' : 'component'
  },
  { immediate: true }
)

const collapseRef = ref<{ $el?: HTMLElement }>()

const handleSectionChange = (section: string | number | boolean | undefined) => {
  if (typeof section !== 'string') return
  activeSection.value = section
  nextTick(() => {
    collapseRef.value?.$el?.scrollTo({ top: 0, behavior: 'smooth' })
  })
}

const updateField = (field: keyof PortalItem, value: any) => {
  if (!props.item || value === undefined || value === null) return
  const next = {
    ...props.item,
    [field]: Math.max(0, Number(value)),
    props: { ...props.item.props }
  }
  if (field === 'w') next.w = Math.min(next.w, 24 - next.x)
  if (field === 'x') next.x = Math.min(next.x, 24 - next.w)
  emit('update', next)
}

const updateProp = (field: string, value: any) => {
  if (!props.item) return
  emit('update', { ...props.item, props: { ...props.item.props, [field]: value } })
}

const updateProps = (values: Record<string, any>) => {
  if (!props.item) return
  emit('update', { ...props.item, props: { ...props.item.props, ...values } })
}

const parseArray = (text: string) => {
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Show a message below and keep the previous valid value.
  }
  message.warning('请输入合法的 JSON 数组')
  return undefined
}

const syncJson = (field: string, text = jsonText.value) => {
  const parsed = parseArray(text)
  if (parsed) updateProp(field, parsed)
}

const syncNestedJson = () => {
  if (!props.item) return
  const parsed = parseArray(nestedText.value)
  if (!parsed) return
  if (props.item.type === 'card') updateProp('children', parsed)
  if (props.item.type === 'tabs') {
    const tabs = cloneDeep(props.item.props.tabs || [])
    const active = tabs.find((tab: any) => tab.id === props.item?.props.active) || tabs[0]
    if (active) {
      active.items = parsed
      updateProp('tabs', tabs)
    }
  }
}

const addNestedItem = () => {
  if (!props.item || !nestedType.value) return
  const tabs = props.item.type === 'tabs' ? props.item.props.tabs || [] : []
  const active = tabs.find((tab: any) => tab.id === props.item?.props.active) || tabs[0]
  emit('addNested', nestedType.value, props.item.id, active?.id)
}

const updateTab = (index: number, field: 'label' | 'icon', value: string) => {
  if (props.item?.type !== 'tabs') return
  const tabs = cloneDeep(props.item.props.tabs || [])
  if (!tabs[index]) return
  tabs[index][field] = value
  updateProp('tabs', tabs)
}

const setActiveTab = (id: string) => updateProp('active', id)

const addTab = () => {
  if (props.item?.type !== 'tabs') return
  const tabs = cloneDeep(props.item.props.tabs || [])
  const id = `tab-${Date.now()}-${tabs.length + 1}`
  tabs.push({ id, label: `标签页 ${tabs.length + 1}`, icon: '', items: [] })
  updateProps({ tabs, active: id })
}

const removeTab = (index: number) => {
  if (props.item?.type !== 'tabs') return
  const tabs = cloneDeep(props.item.props.tabs || [])
  if (tabs.length <= 1 || !tabs[index]) return
  const removed = tabs.splice(index, 1)[0]
  const active =
    removed.id === props.item.props.active
      ? tabs[Math.max(0, index - 1)].id
      : props.item.props.active
  updateProps({ tabs, active })
}

const moveTab = (index: number, offset: number) => {
  if (props.item?.type !== 'tabs') return
  const tabs = cloneDeep(props.item.props.tabs || [])
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= tabs.length) return
  const [tab] = tabs.splice(index, 1)
  tabs.splice(targetIndex, 0, tab)
  updateProp('tabs', tabs)
}

const updateArrayItem = (field: string, index: number, key: string, value: any) => {
  if (!props.item || !Array.isArray(props.item.props[field])) return
  const list = cloneDeep(props.item.props[field])
  if (!list[index]) return
  list[index][key] = value
  updateProp(field, list)
}

const changeImageSource = (value: string) => {
  updateProps({ sourceType: value })
}

const changeVideoSource = (value: string) => {
  updateProps({ sourceType: value })
}

const updateImage = (index: number, field: string, value: any) =>
  updateArrayItem('images', index, field, value)

const addImage = () => {
  if (!props.item || props.item.type !== 'carousel') return
  updateProp('images', [
    ...(props.item.props.images || []),
    { src: '', title: '', link: '', target: '_self' }
  ])
}

const removeImage = (index: number) => {
  if (!props.item || props.item.type !== 'carousel') return
  const images = cloneDeep(props.item.props.images || [])
  images.splice(index, 1)
  updateProp('images', images)
}

const moveImage = (index: number, offset: number) => {
  if (!props.item || props.item.type !== 'carousel') return
  const images = cloneDeep(props.item.props.images || [])
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= images.length) return
  const [image] = images.splice(index, 1)
  images.splice(targetIndex, 0, image)
  updateProp('images', images)
}

const updateFunction = (index: number, field: string, value: any) =>
  updateArrayItem('items', index, field, value)

const addFunction = () => {
  if (!props.item || props.item.type !== 'commonFunc') return
  updateProp('items', [
    ...(props.item.props.items || []),
    { label: '', icon: 'ep:link', color: '#3473ff', url: '', target: '_self' }
  ])
}

const removeFunction = (index: number) => {
  if (!props.item || props.item.type !== 'commonFunc') return
  const items = cloneDeep(props.item.props.items || [])
  items.splice(index, 1)
  updateProp('items', items)
}

const moveFunction = (index: number, offset: number) => {
  if (!props.item || props.item.type !== 'commonFunc') return
  const items = cloneDeep(props.item.props.items || [])
  const targetIndex = index + offset
  if (targetIndex < 0 || targetIndex >= items.length) return
  const [entry] = items.splice(index, 1)
  items.splice(targetIndex, 0, entry)
  updateProp('items', items)
}
</script>

<style lang="scss" scoped>
.portal-properties {
  display: flex;
  height: 100%;
  min-width: 260px;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: var(--portal-surface);
  border-left: 1px solid var(--portal-border-light);
}

.portal-panel-title {
  flex: 0 0 auto;
  padding: 16px 16px 12px;
  margin: 0;
  font-size: 14px;
  font-weight: 650;
  color: var(--portal-text-primary);
}

.portal-properties :deep(.el-form) {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  padding: 0 16px;
  overflow: hidden;
}

.portal-properties__collapse {
  min-height: 0;
  flex: 1;
  padding-bottom: 8px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scroll-behavior: smooth;
}

.portal-properties__section-nav {
  display: flex;
  flex: 0 0 auto;
  width: 100%;
  padding-bottom: 10px;
}

.portal-properties__section-nav :deep(.el-radio-button) {
  flex: 1;
}

.portal-properties__section-nav :deep(.el-radio-button__inner) {
  display: flex;
  width: 100%;
  min-width: 0;
  padding: 7px 8px;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.portal-properties__collapse :deep(.el-collapse-item__header) {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 42px;
  font-size: 13px;
  font-weight: 650;
  color: var(--portal-text-regular);
  background: var(--portal-surface);
}

.portal-properties__collapse :deep(.el-collapse-item__content) {
  padding: 12px 0 8px;
}

.portal-properties :deep(.el-divider) {
  margin: 16px 0 12px;
}

.portal-properties :deep(.el-divider__text) {
  padding: 0 8px 0 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--portal-text-secondary);
}

.portal-properties__nested-title {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--portal-text-secondary);
}

.portal-properties__section-label {
  margin: 4px 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--portal-text-secondary);
}

.portal-properties__tab-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.portal-properties__tab-item {
  padding: 8px;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.portal-properties__tab-item :deep(.selector) {
  margin-top: 8px;
}

.portal-properties__media-list,
.portal-properties__function-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.portal-properties__media-item,
.portal-properties__function-item {
  padding: 8px;
  background: var(--portal-surface-soft);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}

.portal-properties__media-toolbar {
  display: flex;
  min-height: 24px;
  margin-bottom: 6px;
  color: var(--portal-text-secondary);
  align-items: center;
  justify-content: space-between;
}

.portal-properties__media-toolbar > span {
  font-size: 12px;
}

.portal-properties__media-toolbar :deep(.el-button) {
  margin-left: 0;
}

.portal-properties__media-input {
  margin-top: 8px;
}

.portal-properties__function-item :deep(.selector) {
  margin-top: 8px;
}

.portal-properties__function-item :deep(.el-color-picker) {
  margin-top: 8px;
}

.portal-properties__tab-toolbar {
  display: flex;
  min-height: 24px;
  margin-bottom: 6px;
  color: var(--portal-text-secondary);
  align-items: center;
  gap: 4px;
}

.portal-properties__tab-toolbar > span:nth-child(2) {
  flex: 1;
  font-size: 12px;
}

.portal-properties__tab-toolbar-actions {
  display: flex;
  align-items: center;
}

.portal-properties__tab-toolbar :deep(.el-button) {
  margin-left: 0;
}

.portal-properties__tab-toolbar :deep(.is-active) {
  color: var(--el-color-primary);
}

.portal-properties__add-tab {
  width: 100%;
  margin-top: 8px;
}

.portal-properties__add-row {
  display: flex;
  margin-bottom: 10px;
  align-items: center;
  gap: 6px;
}

.portal-properties__actions {
  display: flex;
  flex: 0 0 auto;
  padding: 12px 0 16px;
  margin-top: 0;
  background: var(--portal-surface);
  border-top: 1px solid var(--portal-border-light);
  gap: 8px;
}

.portal-properties :deep(.el-input-number),
.portal-properties :deep(.el-select) {
  max-width: 100%;
}

.w-full {
  width: 100%;
}

.flex-1 {
  flex: 1;
}
</style>
