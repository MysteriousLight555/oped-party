import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { adoptHostKeyFromUrl } from './auth'
import './style.css'

// 支持 ?hostkey=xxx 换设备当主持人：读完即从地址栏移除
adoptHostKeyFromUrl()

createApp(App).use(ElementPlus, { locale: zhCn }).use(router).mount('#app')
