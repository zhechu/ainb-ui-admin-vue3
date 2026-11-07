<template>
  <doc-alert title="服务监控" url="https://doc.enlev.cn/server-monitor/" />

  <!-- 🔴 这一屏原先内嵌一个指向 /admin/applications 的 iframe，而 Spring Boot Admin
       在本仓【从未生效过】：spring-boot-admin-starter-server（enlev-module-infra 的 pom）
       与 spring-boot-admin-starter-client（monitor starter）都是 <optional>true</optional>，
       optional 依赖不传递 ⇒ 两个都没进 enlev-server.jar ⇒ AdminServerConfiguration 的
       @ConditionalOnClass(...AdminServerProperties) 恒为假 ⇒ 它那条 @Order(1) 的
       SecurityFilterChain（表单登录 + HTTP Basic，securityMatcher("/admin/**")）从未注册
       ⇒ /admin/** 落回主 token 链，实测响应体是 code=401、msg=账号未登录，
       带 Basic 口令也一样，【没有登录页可进】。三个 profile 里的 spring.boot.admin.*
       已随 L0 那批部署纪律整块删除（连带 ADMIN_SERVER_PASSWORD 不再是必填）。
       ⚠️ 而本仓所有错误都返回 HTTP 200、真实码在响应体的 code 字段里，
       所以 iframe 不会报错、控制台也干净，用户看到的就是那段 JSON 原文。
       按 I6「关掉的功能要自己说清楚关掉了」这条，这里不再渲染一个坏 iframe，
       改成把事实、替代手段与真要启用时的步骤写在界面上。 -->
  <ContentWrap title="Java 监控" class="!mb-0">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="本部署没有启用 Java 监控（Spring Boot Admin），这一屏没有可显示的内容"
    />
    <div class="mt-16px text-14px leading-26px">
      <p>
        <b>为什么没有</b>：Spring Boot Admin 的两个 starter 在本仓是可选依赖，没有打进
        enlev-server.jar；它那条只保护 /admin/** 的安全链因此从未注册，访问 /admin/
        拿到的是「账号未登录」，而不是一个登录页。相关的配置项也已从三份 profile
        里整块删除，所以这不是「配错了」，是「没有装」。
      </p>
      <p class="mt-12px">
        <b>现在用什么看运行状态</b>：生产环境的 actuator 在独立的管理端口 48081 上，
        只开放 health 与 info 两个端点，业务端口 48080 上已经没有 /actuator；
        启动脚本与部署脚本的健康检查打的就是 48081，判据是响应体里的
        "status":"UP"（本仓所有 HTTP 状态码都是 200，按状态码探活是废的）。
        本地与开发环境不拆端口，仍在 48080 上，且刻意保留全部端点供排障。
      </p>
      <p class="mt-12px">
        <b>真要启用需要哪几步</b>：把两个 starter 的可选标记去掉（或在 enlev-server
        的 pom 里显式声明）→ 把 spring.boot.admin.* 配置加回来，其中 password 要写成
        没有默认值的占位符，并同步加进启动期的必填配置校验与 start.sh 的必填清单 →
        先修掉 AdminServerConfiguration 里那个 context-path 的 @Value（它的默认值是
        「两个单引号字符」而不是空串，缺配时会生成一个匹配不到任何路径的
        securityMatcher）→ 单独走一遍安全评审：那是在业务端口上开一个从未运行过的
        鉴权控制台，进去能看实例列表、在线改日志级别、抓线程与堆快照，
        而堆里有 token 与全部配置。
      </p>
      <p class="mt-12px">
        <b>启用之后不要做的事</b>：不要再给 /admin/** 加放行。一旦哪天这两个依赖又变回
        可选，那条安全链会消失，一个放行的 /admin/** 就会静默退化成匿名的 JVM 控制台。
      </p>
    </div>
  </ContentWrap>
</template>
<script lang="ts" setup>
defineOptions({ name: 'InfraAdminServer' })
</script>
