<template>
  <w-page class="admin-mail">
    <div class="flex flex-wrap p-4 items-center">
      <div class="flex-none">
        <img
          class="admin-icon animated fadeInLeft"
          src="/_assets/icons/fluent-rich-text-converter.svg" />
      </div>
      <div class="min-w-0 flex-1 pl-4">
        <div class="text-h5 admin-page-title animated fadeInLeft">
          {{ $t('admin.rendering.title') }}
        </div>
        <div class="text-subtitle1 text-grey animated fadeInLeft wait-p2s">
          {{ $t('admin.rendering.subtitle') }}
        </div>
      </div>
      <div class="flex-none">
        <w-btn
          class="mr-2 acrylic-btn"
          icon="la:question-circle"
          flat
          color="grey"
          :href="siteStore.docsBase + `/admin/rendering`"
          target="_blank" />
        <w-btn
          class="mr-2 acrylic-btn"
          icon="la:redo-alt"
          flat
          color="secondary"
          :loading="state.loading > 0"
          @click="load">
          <w-tooltip>{{ t(`common.actions.refresh`) }}</w-tooltip>
        </w-btn>
        <w-btn
          unelevated
          icon="mdi:check"
          :label="$t(`common.actions.apply`)"
          color="secondary"
          @click="save"
          :disabled="state.loading > 0" />
      </div>
    </div>
    <w-separator inset />
    <div class="flex flex-wrap p-4 gap-4">
      <div class="flex-none">
        <w-card class="rounded" :class="dark.isActive ? `bg-dark` : `bg-white`">
          <w-list style="min-width: 300px" padding :dark="dark.isActive">
            <w-item
              v-for="rdr of state.renderers"
              :key="rdr.key"
              :active-class="dark.isActive ? `bg-primary text-white` : `bg-primary/15 text-primary`"
              :active="state.selectedRenderer === rdr.id"
              @click="state.selectedRenderer = rdr.id"
              clickable>
              <w-item-section side><w-icon :name="`img:` + rdr.icon" /></w-item-section>
              <w-item-section>
                <w-item-label>{{ rdr.title }}</w-item-label>
                <w-item-label caption>{{ rdr.description }}</w-item-label>
              </w-item-section>
              <w-item-section side>
                <status-light
                  :color="rdr.isEnabled ? `positive` : `negative`"
                  :pulse="rdr.isEnabled" />
              </w-item-section>
            </w-item>
          </w-list>
        </w-card>
      </div>
      <div class="min-w-0 flex-1">
        <div class="grid grid-cols-12 gap-4"><div class="col-span-12" /></div>
      </div>
    </div>
  </w-page>
</template>

<script setup>
import { useI18n } from 'vue-i18n'
import { useDark } from '@/composables/dark'
import { computed, onMounted, reactive, watch } from 'vue'

import { useMeta } from '@/composables/meta'

import { useAdminStore } from '@/stores/admin'
import { useSiteStore } from '@/stores/site'

// STORES

const adminStore = useAdminStore()
const siteStore = useSiteStore()

// I18N

const { t } = useI18n()

// DARK MODE

const dark = useDark()

// META

useMeta(() => ({
  title: t('admin.rendering.title')
}))

// DATA

const state = reactive({
  renderers: [
    {
      id: '123',
      title: 'Core',
      description: 'Base HTML Transformer',
      isEnabled: true,
      icon: '/_assets/icons/ultraviolet-brick.svg'
    }
  ],
  selectedRenderer: '',
  loading: 0
})

// METHODS

async function load() {}

async function save() {}
</script>
