const nest = require('depnest')
const { h, Value, Struct, map, computed } = require('mutant')
const MutantArray = require('mutant/Array')
const concat = require('lodash/concat')
const filter = require('lodash/filter')
const zip = require('lodash/zip')
const forEach = require('lodash/forEach')
const addSuggest = require('suggest-box')

exports.gives = nest('tag.html.edit')

exports.needs = nest({
  'about.obs.name': 'first',
  'keys.sync.id': 'first',
  'tag.async.apply': 'first',
  'tag.async.create': 'first',
  'tag.async.name': 'first',
  'tag.html.tag': 'first',
  'tag.obs.allTags': 'first',
  'tag.obs.messageTagsFrom': 'first',
  'tag.obs.tag': 'first',
})

exports.create = function(api) {
  return nest({ 'tag.html.edit': edit })

  function edit({ msgId }, cb) {
    const tagsToCreate = MutantArray([])
    const tagsToApply = MutantArray([])
    const tagsToRemove = MutantArray([])
    const tagsInput = Value('')

    const myId = api.keys.sync.id()
    const messageTags = map(
      api.tag.obs.messageTagsFrom(msgId, myId),
      tagId => api.tag.obs.tag(tagId)
    )
    const filteredMessages = computed(
      [ messageTags, tagsToRemove ],
      (tags, removedIds) => filter(tags, tag => !removedIds.includes(tag.tagId))
    )

    const messageTagsView = map(
      filteredMessages,
      tag => computed(tag, t => api.tag.html.tag(t, () => tagsToRemove.push(t.tagId)))
    )
    const tagsToApplyView = map(
      tagsToApply,
      tag => api.tag.html.tag(tag, () => tagsToApply.delete(tag))
    )
    const tagsToCreateView = map(
      tagsToCreate,
      tag => api.tag.html.tag({ tagName: tag, tagId: 'new' }, () => tagsToCreate.delete(tag))
    )
    const stagedTags = computed(
      [messageTagsView, tagsToApplyView, tagsToCreateView],
      (a, b, c) => h('StagedTags', concat(a, [b, c]))
    )

    const input = h('input.tags', {
      placeholder: 'Add tags here',
      'ev-keyup': onInput,
      value: tagsInput()
    })

    input.addEventListener('suggestselect', onSuggestSelect)

    return {
      content: [
        stagedTags,
        h('EditTags', input)
      ],
      onMount,
      onSave,
    }

    function onMount() {
      input.focus()
      addSuggest(input, (inputText, cb) => {
        cb(null, getTagSuggestions(inputText))
      }, { cls: 'ConfirmSuggest' })
    }

    function onInput(e) {
      const input = e.target.value;
      if (!input.endsWith(",")) {
        tagsInput.set(input)
        return
      }
      const tag = input.substring(0, input.length - 1)
      tagsToCreate.push(tag)
      e.target.value = ""
    }

    function onSuggestSelect(e) {
      e.target.value = ""
      const { value, tagId } = e.detail
      const index = tagsToRemove().indexOf(tagId)
      if (index >= 0) {
        tagsToRemove.deleteAt(index)
      } else {
        tagsToApply.push({ tagId, tagName: value })
      }
    }

    function getTagSuggestions(word) {
      const suggestions = map(
        api.tag.obs.allTags(),
        tagId => {
          const tagName = api.about.obs.name(tagId)()
          return {
            title: tagName,
            value: tagName,
            tagId
          }
        }
      )()
      const appliedTagIds = map(filteredMessages, tag => tag.tagId)
      const applyTagIds = map(tagsToApply, tag => tag.tagId)
      const stagedTagIds = computed([ appliedTagIds, applyTagIds ], (a, b) => concat(a, b))()
      const filteredSuggestions = filter(suggestions, tag => !stagedTagIds.includes(tag.tagId))
      filteredSuggestions.push({ title: "Press , to create a new tag" })
      return filteredSuggestions
    }

    function onSave() {
      // tagsToCreate
      forEach(
        tagsToCreate(),
        tag => {
          api.tag.async.create(null, (err, msg) => {
            if (err) return
            api.tag.async.name({ tag: msg.key, name: tag }, cb)
            api.tag.async.apply({ tagged: true, message: msgId, tag: msg.key }, cb)
          })
        }
      )

      // tagsToApply
      forEach(
        tagsToApply(),
        tag => api.tag.async.apply({ tagged: true, message: msgId, tag: tag.tagId }, cb)
      )

      // tagsToRemove
      forEach(
        tagsToRemove(),
        tagId => api.tag.async.apply({ tagged: false, message: msgId, tag: tagId }, cb)
      )
    }
  }
}