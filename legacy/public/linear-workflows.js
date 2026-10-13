(() => {
  function init(){
  const host = window.LinearHost;
  if (!host) return;
  const esc = host.esc;
  const $ = selector => document.querySelector(selector);
  const state = () => host.state();
  const list = key => state().data[key] || [];
  const date = value => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'}) : 'None';
  const button = (label, action, attrs='') => `<button class="subtle-button" data-action="${action}" ${attrs}>${label}</button>`;
  const field = (label, control) => `<div class="field"><label>${label}</label>${control}</div>`;
  const select = (id, options, selected='') => `<select id="${id}">${options.map(([value,label])=>`<option value="${esc(value)}" ${String(value)===String(selected)?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
  const projectOptions = () => [['','No project'],...list('projects').map(p=>[p.id,p.name])];
  const teamOptions = () => state().enterprise.teams.map(t=>[t.id,t.name]);
  const issueOptions = (exclude='',teamId='') => [['','None'],...list('issues').filter(i=>i.id!==exclude&&(!teamId||i.teamId===teamId)).map(i=>[i.id,`${i.id} · ${i.title}`])];
  const htmlText = text => esc(text||'').replace(/\n/g,'<br>');
  const mark = (text,sub='') => `<div class="wf-row-main"><strong>${esc(text)}</strong>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
  const workflowCategories=[['backlog','Backlog'],['unstarted','Unstarted'],['started','Started'],['completed','Completed'],['canceled','Canceled'],['duplicate','Duplicate']];
  const statusesFor=teamId=>(state().enterprise.issueStatuses||[]).filter(status=>status.team_id===teamId);
  const defaultStatus=teamId=>statusesFor(teamId).find(status=>status.is_default)?.name||statusesFor(teamId)[0]?.name||'Backlog';

  function issueCreateFields(draft){
    const milestones=host.projectBy(draft.projectId)?.milestones||[];
    const templates=list('issueTemplates').filter(t=>t.teamId===draft.teamId);
    return `${templates.length?field('Template',select('wf-template-choice',[['','No template'],...templates.map(t=>[t.id,t.name])],draft.templateId||'')):''}<div class="wf-form-grid">${field('Labels',`<input id="wf-draft-labels" placeholder="Bug, Feature" value="${esc((draft.labels||[]).join(', '))}">`)}${field('Due date',`<input id="wf-draft-due" type="date" value="${esc(draft.dueDate||'')}">`)}${field('Estimate',`<input id="wf-draft-estimate" type="number" min="0" max="1000" placeholder="Points" value="${esc(draft.estimate??'')}">`)}${field('Parent issue',select('wf-draft-parent',issueOptions('',draft.teamId),draft.parentId||''))}${milestones.length?field('Milestone',select('wf-draft-milestone',[['','None'],...milestones.map(m=>[m.id,m.name])],draft.milestoneId||'')):''}</div>`;
  }
  function readIssueDraft(){
    const estimate=$('#wf-draft-estimate')?.value;
    return {labels:($('#wf-draft-labels')?.value||'').split(',').map(x=>x.trim()).filter(Boolean),dueDate:$('#wf-draft-due')?.value||'',estimate:estimate===''?null:Number(estimate),parentId:$('#wf-draft-parent')?.value||'',milestoneId:$('#wf-draft-milestone')?.value||''};
  }
  function issuePanel(issue){
    const children=list('issues').filter(i=>i.parentId===issue.id);
    const linked=(ids,label)=>`<div class="activity-title">${label}</div><div class="wf-linked">${(ids||[]).map(id=>{const item=list('issues').find(i=>i.id===id);return item?`<button class="wf-linked-row" data-action="wf-open-issue" data-id="${esc(id)}">${esc(id)} · ${esc(item.title)}</button>`:''}).join('')||'<span class="enterprise-muted">None</span>'}</div>`;
    const milestone=host.projectBy(issue.projectId)?.milestones?.find(m=>m.id===issue.milestoneId);
    const related=[...new Set([...(issue.relatedIds||[]),...list('issues').filter(i=>(i.relatedIds||[]).includes(issue.id)).map(i=>i.id)])];
    const blocks=list('issues').filter(i=>(i.blockedByIds||[]).includes(issue.id)).map(i=>i.id);
    return `<div class="wf-issue-properties"><div><span>Due date</span><strong>${date(issue.dueDate)}</strong></div><div><span>Estimate</span><strong>${issue.estimate??'None'}</strong></div><div><span>Parent</span><strong>${issue.parentId?esc(issue.parentId):'None'}</strong></div>${milestone?`<div><span>Milestone</span><strong>${esc(milestone.name)}</strong></div>`:''}</div><div class="wf-toolbar">${button('Edit details','wf-edit-issue',`data-id="${esc(issue.id)}"`)}${button('Add subissue','wf-new-subissue',`data-id="${esc(issue.id)}"`)}${button('Link issue','wf-link-issue',`data-id="${esc(issue.id)}"`)}</div>${children.length?`<div class="activity-title">Subissues · ${children.length}</div><div class="wf-linked">${children.map(i=>`<button class="wf-linked-row" data-action="wf-open-issue" data-id="${esc(i.id)}">${esc(i.id)} · ${esc(i.title)}</button>`).join('')}</div>`:''}${linked(related,'Related issues')}${linked(issue.blockedByIds,'Blocked by')}${blocks.length?linked(blocks,'Blocks'):''}`;
  }
  function projectFormFields(project){
    return `<div class="wf-form-grid">${field('Priority',select('wf-project-priority',['No priority','Urgent','High','Medium','Low'].map(x=>[x,x]),project?.priority||'No priority'))}${field('Start date',`<input id="wf-project-start" type="date" value="${esc(project?.startDate||'')}">`)}${field('Labels',`<input id="wf-project-labels" placeholder="Product, Platform" value="${esc((project?.labels||[]).join(', '))}">`)}</div>`;
  }
  function readProjectForm(){return {priority:$('#wf-project-priority')?.value||'No priority',startDate:$('#wf-project-start')?.value||'',labels:($('#wf-project-labels')?.value||'').split(',').map(x=>x.trim()).filter(Boolean)};}
  function initiativeFormFields(initiative){
    const candidates=list('initiatives').filter(i=>i.id!==initiative?.id);
    return `<div class="field"><label>Parent initiatives</label><div class="wf-checkbox-list">${candidates.map(i=>`<label><input type="checkbox" name="wf-initiative-parent" value="${esc(i.id)}" ${(initiative?.parentIds||[]).includes(i.id)?'checked':''}> ${esc(i.name)}</label>`).join('')||'<span class="enterprise-muted">Create another initiative to build a hierarchy.</span>'}</div></div>`;
  }
  function readInitiativeForm(){return {parentIds:[...document.querySelectorAll('input[name="wf-initiative-parent"]:checked')].map(input=>input.value)};}
  function initiativePanel(initiative){
    const children=list('initiatives').filter(i=>(i.parentIds||[]).includes(initiative.id));
    const parents=(initiative.parentIds||[]).map(id=>list('initiatives').find(i=>i.id===id)).filter(Boolean);
    return `<section class="wf-section"><div class="wf-section-head"><h3>Hierarchy</h3></div>${parents.map(i=>`<button class="wf-row wf-clickable" data-action="wf-open-initiative" data-id="${esc(i.id)}">${host.icons.project}${mark(i.name,'Parent initiative')}</button>`).join('')}${children.map(i=>`<button class="wf-row wf-clickable" data-action="wf-open-initiative" data-id="${esc(i.id)}">${host.icons.project}${mark(i.name,'Sub-initiative')}</button>`).join('')||(!parents.length?'<p class="enterprise-muted">Link a parent or add a sub-initiative from its settings.</p>':'')}</section>`;
  }
  function projectPanel(project){
    const milestones=project.milestones||[];
    const updates=project.updates||[];
    const issueCount=id=>list('issues').filter(i=>i.projectId===project.id&&i.milestoneId===id).length;
    const blockedBy=(project.blockedByProjectIds||[]).map(id=>host.projectBy(id)).filter(Boolean);
    const blocking=list('projects').filter(p=>(p.blockedByProjectIds||[]).includes(project.id));
    return `<section class="wf-section"><div class="wf-section-head"><h3>Milestones</h3>${button('+ Milestone','wf-new-milestone',`data-id="${esc(project.id)}"`)}</div>${milestones.length?milestones.map(m=>`<div class="wf-row"><span class="wf-diamond">◆</span>${mark(m.name,`${issueCount(m.id)} issues · ${m.targetDate?date(m.targetDate):'No target date'}`)}<button class="icon-btn" data-action="wf-edit-milestone" data-id="${esc(project.id)}" data-milestone="${esc(m.id)}" title="Edit milestone">⋯</button></div>`).join(''):'<p class="enterprise-muted">Add milestones to organize delivery stages.</p>'}</section><section class="wf-section"><div class="wf-section-head"><h3>Dependencies</h3>${button('+ Dependency','wf-new-dependency',`data-id="${esc(project.id)}"`)}</div>${blockedBy.map(p=>`<button class="wf-row wf-clickable" data-action="wf-open-project" data-id="${esc(p.id)}">${host.icons.project}${mark(p.name,'Blocked by')}</button>`).join('')}${blocking.map(p=>`<button class="wf-row wf-clickable" data-action="wf-open-project" data-id="${esc(p.id)}">${host.icons.project}${mark(p.name,'Blocking')}</button>`).join('')||(!blockedBy.length?'<p class="enterprise-muted">No dependencies.</p>':'')}</section><section class="wf-section"><div class="wf-section-head"><h3>Project updates</h3>${button('+ Update','wf-new-update',`data-id="${esc(project.id)}"`)}</div>${updates.length?updates.slice().reverse().map(u=>`<div class="wf-update"><strong>${esc(u.health||'Update')}</strong><small>${esc(u.by||'Team')} · ${date((u.createdAt||'').slice(0,10))}</small><p>${htmlText(u.text)}</p></div>`).join(''):'<p class="enterprise-muted">Share a progress update with your team.</p>'}</section><section class="wf-section"><div class="wf-section-head"><h3>Resources</h3>${button('+ Document','wf-new-document',`data-project="${esc(project.id)}"`)}</div>${list('documents').filter(d=>d.projectId===project.id).map(d=>`<button class="wf-row wf-clickable" data-action="wf-open-document" data-id="${esc(d.id)}">${host.icons.list}${mark(d.name,'Document')}</button>`).join('')||'<p class="enterprise-muted">No documents linked to this project.</p>'}</section>`;
  }

  function renderPage(page){
    if(page==='documents')return documentsPage();
    if(page==='customers')return customersPage();
    if(page==='releases')return releasesPage();
    if(page==='templates')return templatesPage();
    if(page==='statuses')return statusesPage();
    return '';
  }
  function documentsPage(){
    return `${host.head('Documents','Plans, specifications, and decisions in one place.',`<button class="primary-button" data-action="wf-new-document">+ New document</button>`)}<div class="wf-card-list">${list('documents').map(d=>`<button class="wf-row wf-clickable" data-action="wf-open-document" data-id="${esc(d.id)}">${host.icons.list}${mark(d.name,d.projectId?`Project · ${host.projectBy(d.projectId)?.name||'Unknown'}`:'Workspace document')}</button>`).join('')||host.empty('No documents yet','Write a plan or link a document to a project.','wf-new-document','New document')}</div>`;
  }
  function customersPage(){
    return `${host.head('Customers','Connect product work to customer feedback.',`<button class="primary-button" data-action="wf-new-customer">+ New customer</button>`)}<div class="wf-card-list">${list('customers').map(c=>`<button class="wf-row wf-clickable" data-action="wf-open-customer" data-id="${esc(c.id)}"><span class="wf-avatar">${esc(c.name?.[0]||'C')}</span>${mark(c.name,`${c.tier||'No tier'} · ${list('customerRequests').filter(r=>r.customerId===c.id).length} requests`)}<span class="wf-row-meta">${esc(c.status||'Active')}</span></button>`).join('')||host.empty('No customers yet','Add customers to capture and prioritize requests.','wf-new-customer','New customer')}</div>`;
  }
  function releasesPage(){
    const pipelines=list('releasePipelines');
    return `${host.head('Releases','Track what shipped and when.',`<button class="primary-button" data-action="wf-new-pipeline">+ New pipeline</button>`)}${pipelines.map(p=>`<section class="wf-section"><div class="wf-section-head"><div><h3>${esc(p.name)}</h3><small>${esc(p.type)} · ${esc(p.environment||'Environment')}</small></div>${button('+ Release','wf-new-release',`data-pipeline="${esc(p.id)}"`)}</div>${list('releases').filter(r=>r.pipelineId===p.id).map(r=>`<button class="wf-row wf-clickable" data-action="wf-open-release" data-id="${esc(r.id)}">${host.icons.cycle}${mark(r.name,`${r.issueIds?.length||0} issues · ${r.date?date(r.date):'No date'}`)}<span class="wf-row-meta">${esc(r.status)}</span></button>`).join('')||'<p class="enterprise-muted">No releases in this pipeline.</p>'}</section>`).join('')||host.empty('No release pipelines yet','Create a continuous or scheduled pipeline.','wf-new-pipeline','New pipeline')}`;
  }
  function templatesPage(){
    const templates=list('issueTemplates').filter(t=>t.teamId===state().ui.teamId);
    return `${host.head('Templates','Start recurring work with consistent issue details.',`<button class="primary-button" data-action="wf-new-template">+ New template</button>`)}<div class="wf-card-list">${templates.map(t=>`<button class="wf-row wf-clickable" data-action="wf-edit-template" data-id="${esc(t.id)}">${host.icons.issue}${mark(t.name,t.title||'Issue template')}${host.icons.chevron}</button>`).join('')||host.empty('No templates yet','Create an issue template for this team.','wf-new-template','New template')}</div>`;
  }
  function statusesPage(){
    const teamId=state().ui.teamId,team=state().enterprise.teams.find(item=>item.id===teamId),editor=state().ui.statusEditor;
    const statuses=statusesFor(teamId);
    const canManage=['owner','admin'].includes(state().enterprise.user.role)||(state().enterprise.teamMembers||[]).some(member=>member.team_id===teamId&&member.user_id===state().enterprise.user.id&&member.role==='owner');
    const inline=(id,category)=>{const current=statuses.find(item=>item.id===id)||{};return `<div class="wf-inline-editor"><input id="wf-status-name" maxlength="40" aria-label="Status name" placeholder="Status name" value="${esc(current.name||'')}"><input id="wf-status-description" maxlength="180" aria-label="Status description" placeholder="Description" value="${esc(current.description||'')}"><input id="wf-status-category" type="hidden" value="${esc(current.category||category)}"><button class="subtle-button" data-action="wf-cancel-status">Cancel</button><button class="primary-button" data-action="wf-save-status" data-id="${esc(id||'')}">${id?'Save':'Create'}</button></div>`};
    return `${host.head('Issue statuses',`Workflow for ${team?.name||'this team'}. Statuses are shared by issues, views, and automations.`)}${workflowCategories.map(([category,label])=>`<section class="wf-section"><div class="wf-section-head"><h3>${label}</h3>${canManage?button('+ New status','wf-new-status',`data-category="${category}"`):''}</div>${statuses.filter(status=>status.category===category).map((status,index,group)=>`<div class="wf-row"><span class="wf-status-dot ${esc(category)}"></span>${mark(status.name,status.description||'')}<span class="wf-status-count">${list('issues').filter(i=>i.teamId===teamId&&i.status===status.name).length} ${list('issues').filter(i=>i.teamId===teamId&&i.status===status.name).length===1?'issue':'issues'}</span>${status.is_default?'<span class="enterprise-badge">Default</span>':''}${canManage?`<span class="wf-status-actions">${index?button('↑','wf-move-status',`data-id="${esc(status.id)}" data-direction="up"`):''}${index<group.length-1?button('↓','wf-move-status',`data-id="${esc(status.id)}" data-direction="down"`):''}${!status.is_default&&['backlog','unstarted'].includes(category)?button('Make default','wf-default-status',`data-id="${esc(status.id)}"`):''}${button('Edit','wf-edit-status',`data-id="${esc(status.id)}"`)}</span>`:''}</div>${editor?.id===status.id?inline(status.id,category):''}`).join('')||'<p class="enterprise-muted">No statuses in this category.</p>'}${editor&&!editor.id&&editor.category===category?inline('',category):''}</section>`).join('')}`;
  }
  function deleteStatusModal(id){
    const statuses=statusesFor(state().ui.teamId),current=statuses.find(item=>item.id===id);if(!current)return;
    const alternatives=statuses.filter(item=>item.id!==id&&item.category===current.category);
    if(!alternatives.length){host.toast('Create another status in this category before deleting this one.');return}
    host.modal(`<div class="modal-head">${host.icons.issue}<span>Delete ${esc(current.name)}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><p>Issues and templates using this status will move to:</p>${field('Replacement status',select('wf-replacement-status',alternatives.map(item=>[item.id,item.name])))}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-confirm-delete-status" data-id="${esc(id)}">Move issues and delete</button></div>`,'compact');
  }

  function matches(item,filter){
    let value=item[filter.field];
    if(Array.isArray(value))value=value.join(' ');
    value=String(value??'').toLowerCase();const sought=String(filter.value||'').toLowerCase();
    return filter.op==='isNot'?value!==sought:filter.op==='contains'?value.includes(sought):value===sought;
  }
  function filterViewIssues(issues,view){return Array.isArray(view?.filters)?issues.filter(i=>view.filters.every(f=>matches(i,f))):issues;}
  function viewCount(view){
    const records=view.entity==='project'?list('projects'):view.entity==='initiative'?list('initiatives'):list('issues');
    if(Array.isArray(view.filters))return records.filter(item=>view.filters.every(f=>matches(item,f))).length;
    if(view.type==='priority')return records.filter(i=>['Urgent','High'].includes(i.priority)).length;
    if(view.type==='unassigned')return records.filter(i=>!i.assignee).length;
    return records.filter(i=>['unstarted','started'].includes(host.statusCategory(i.status,i.teamId))).length;
  }
  function renderView(view){
    const records=view.entity==='project'?list('projects'):list('initiatives');
    const matched=Array.isArray(view.filters)?records.filter(r=>view.filters.every(f=>matches(r,f))):records;
    return `${host.head(view.name,view.description||'Saved view',`<button class="subtle-button" data-action="wf-edit-view" data-id="${esc(view.id)}">Edit view</button>`)}<div class="wf-card-list">${matched.map(item=>`<button class="wf-row wf-clickable" data-action="wf-open-${view.entity}" data-id="${esc(item.id)}">${host.icons.project}${mark(item.name,item.status||'')}${host.icons.chevron}</button>`).join('')||host.empty('No matching records','Change this view’s filters to see more.')}</div>`;
  }
  function newView(existing){
    const view=existing||{};
    const scope=view.scope||(view._ownerUserId?'personal':view.teamId?'team':'workspace');
    host.modal(`<div class="modal-head">${host.icons.views}<span>${existing?'Edit view':'New view'}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Name',`<input id="wf-view-name" maxlength="180" placeholder="e.g. At-risk projects" value="${esc(view.name||'')}">`)}${field('Description',`<input id="wf-view-description" value="${esc(view.description||'')}">`)}<div class="wf-form-grid">${field('Show',select('wf-view-entity',[['issue','Issues'],['project','Projects'],['initiative','Initiatives']],view.entity||'issue'))}${field('Scope',existing?`<p>${esc(scope)}</p><input id="wf-view-scope" type="hidden" value="${esc(scope)}">`:select('wf-view-scope',[['workspace','Workspace'],['team','Team'],['personal','Personal']],scope))}</div><div class="wf-section-head"><h3>Filters</h3>${button('+ Add filter','wf-add-filter')}</div><div id="wf-view-filters">${(view.filters||[]).map(renderFilterRow).join('')}</div><p class="enterprise-muted">All filters must match. Use “contains” for labels or text fields.</p></div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-view" data-id="${esc(view.id||'')}">Save view</button></div>`,'compact');
  }
  function renderFilterRow(filter={}){
    const fields=[['status','Status'],['priority','Priority'],['assignee','Assignee'],['project','Project'],['cycle','Cycle'],['labels','Labels'],['teamId','Team'],['lead','Project lead'],['initiativeId','Initiative']];
    return `<div class="wf-filter-row">${select('wf-filter-field',fields,filter.field||'status')}${select('wf-filter-op',[['is','is'],['isNot','is not'],['contains','contains']],filter.op||'is')}<input class="wf-filter-value" placeholder="Value" value="${esc(filter.value||'')}"><button class="icon-btn" data-action="wf-remove-filter" title="Remove filter">×</button></div>`;
  }
  function searchResults(query){
    if(!query)return '';
    const groups=[['Documents','documents','document','name'],['Customers','customers','customer','name'],['Releases','releases','release','name']];
    return groups.map(([title,key,kind,field])=>{const matches=list(key).filter(item=>String(item[field]||'').toLowerCase().includes(query)).slice(0,4);return matches.length?`<div class="menu-label">${title}</div>${matches.map(item=>`<button class="search-result" data-action="wf-open-${kind}" data-id="${esc(item.id)}">${host.icons.search}<span>${esc(item[field])}</span></button>`).join('')}`:''}).join('');
  }
  function bulkToolbar(){
    const selected=state().ui.selectedIssueIds||[];
    if(!selected.length)return '';
    return `<div class="wf-bulk-bar"><strong>${selected.length} selected</strong>${button('Set status','wf-bulk-status')}${button('Set priority','wf-bulk-priority')}${button('Clear','wf-bulk-clear')}</div>`;
  }
  function bulkModal(fieldName){
    const selectedTeams=[...new Set(state().ui.selectedIssueIds.map(id=>host.issueBy(id)?.teamId).filter(Boolean))];
    const common=selectedTeams.length?statusesFor(selectedTeams[0]).filter(status=>selectedTeams.every(teamId=>statusesFor(teamId).some(candidate=>candidate.name===status.name))).map(status=>status.name):[];
    const options=fieldName==='status'?common:['Urgent','High','Medium','Low','No priority'];
    host.modal(`<div class="modal-head">${host.icons.issue}<span>Update ${state().ui.selectedIssueIds.length} ${list('issues').filter(i=>i.teamId===teamId&&i.status===status.name).length===1?'issue':'issues'}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field(fieldName==='status'?'Status':'Priority',select('wf-bulk-value',options.map(x=>[x,x])))}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-bulk-save" data-field="${fieldName}">Apply to issues</button></div>`,'compact');
  }

  function issueDetailsModal(id){
    const issue=host.issueBy(id);if(!issue)return;
    const milestones=host.projectBy(issue.projectId)?.milestones||[];
    host.modal(`<div class="modal-head">${host.icons.issue}<span>${esc(id)} · Details</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><div class="wf-form-grid">${field('Due date',`<input id="wf-issue-due" type="date" value="${esc(issue.dueDate||'')}">`)}${field('Start date',`<input id="wf-issue-start" type="date" value="${esc(issue.startDate||'')}">`)}${field('Estimate',`<input id="wf-issue-estimate" type="number" min="0" max="1000" value="${esc(issue.estimate??'')}">`)}${field('Parent issue',select('wf-issue-parent',issueOptions(id,issue.teamId),issue.parentId||''))}${milestones.length?field('Milestone',select('wf-issue-milestone',[['','None'],...milestones.map(m=>[m.id,m.name])],issue.milestoneId||'')):''}</div></div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-issue" data-id="${esc(id)}">Save details</button></div>`,'compact');
  }
  function linkIssueModal(id){
    host.modal(`<div class="modal-head">${host.icons.issue}<span>Link issue</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Relationship',select('wf-link-type',[['relatedIds','Related'],['blockedByIds','Blocked by']]))}${field('Issue',select('wf-link-target',issueOptions(id,host.issueBy(id)?.teamId)))}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-link" data-id="${esc(id)}">Link issue</button></div>`,'compact');
  }
  function milestoneModal(projectId,milestoneId=''){
    const p=host.projectBy(projectId);const m=(p?.milestones||[]).find(x=>x.id===milestoneId)||{};
    host.modal(`<div class="modal-head">${host.icons.project}<span>${milestoneId?'Edit':'New'} milestone</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Name',`<input id="wf-milestone-name" maxlength="180" value="${esc(m.name||'')}">`)}${field('Description',`<textarea id="wf-milestone-description">${esc(m.description||'')}</textarea>`)}${field('Target date',`<input id="wf-milestone-date" type="date" value="${esc(m.targetDate||'')}">`)}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-milestone" data-id="${esc(projectId)}" data-milestone="${esc(milestoneId)}">Save milestone</button></div>`,'compact');
  }
  function updateModal(projectId){host.modal(`<div class="modal-head">${host.icons.project}<span>Project update</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Health',select('wf-update-health',[['On track','On track'],['At risk','At risk'],['Off track','Off track']]))}${field('Update',`<textarea id="wf-update-text" rows="6" placeholder="What changed this week?"></textarea>`)}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-update" data-id="${esc(projectId)}">Post update</button></div>`,'compact')}
  function dependencyModal(projectId){
    host.modal(`<div class="modal-head">${host.icons.project}<span>Add project dependency</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Blocked by',select('wf-dependency-project',[['','Choose project'],...list('projects').filter(p=>p.id!==projectId).map(p=>[p.id,p.name])]))}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-dependency" data-id="${esc(projectId)}">Add dependency</button></div>`,'compact');
  }
  function documentModal(id='',projectId=''){
    const d=list('documents').find(item=>item.id===id)||{};
    host.modal(`<div class="modal-head">${host.icons.list}<span>${id?'Edit document':'New document'}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Title',`<input id="wf-doc-name" maxlength="180" value="${esc(d.name||'')}">`)}${field('Project',select('wf-doc-project',projectOptions(),d.projectId||projectId))}${field('Content',`<textarea id="wf-doc-content" class="wf-editor" placeholder="Write a plan, PRD, or decision…">${esc(d.content||'')}</textarea>`)}</div><div class="modal-footer">${id?button('Delete','wf-delete-document',`data-id="${esc(id)}"`):''}<span class="spacer"></span><button class="primary-button" data-action="wf-save-document" data-id="${esc(id)}">Save document</button></div>`,'compact');
  }
  function customerModal(id=''){
    const c=list('customers').find(item=>item.id===id)||{};
    host.modal(`<div class="modal-head">${host.icons.my}<span>${id?'Edit customer':'New customer'}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Name',`<input id="wf-customer-name" maxlength="180" value="${esc(c.name||'')}">`)}<div class="wf-form-grid">${field('Domain',`<input id="wf-customer-domain" placeholder="example.com" value="${esc(c.domain||'')}">`)}${field('Tier',select('wf-customer-tier',[['','None'],['Enterprise','Enterprise'],['Business','Business'],['Startup','Startup']],c.tier||''))}${field('Status',select('wf-customer-status',[['Active','Active'],['Prospect','Prospect'],['Churned','Churned']],c.status||'Active'))}${field('Revenue',`<input id="wf-customer-revenue" type="number" min="0" value="${esc(c.revenue??'')}">`)}</div>${field('Notes',`<textarea id="wf-customer-notes">${esc(c.notes||'')}</textarea>`)}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-customer" data-id="${esc(id)}">Save customer</button></div>`,'compact');
  }
  function customerDetail(id){
    const c=list('customers').find(item=>item.id===id);if(!c)return;
    host.modal(`<div class="modal-head">${host.icons.my}<span>${esc(c.name)}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><p>${esc(c.domain||'No domain')} · ${esc(c.tier||'No tier')} · ${esc(c.status||'Active')}</p><p>${htmlText(c.notes)}</p><div class="wf-section-head"><h3>Requests</h3>${button('+ Request','wf-new-customer-request',`data-customer="${esc(c.id)}"`)}</div>${list('customerRequests').filter(r=>r.customerId===c.id).map(r=>`<div class="wf-row">${mark(r.title,r.issueId||host.projectBy(r.projectId)?.name||'Project')}</div>`).join('')||'<p class="enterprise-muted">No requests yet.</p>'}</div><div class="modal-footer">${button('Edit customer','wf-edit-customer',`data-id="${esc(id)}"`)}<span class="spacer"></span><button class="primary-button" data-action="close-modal">Done</button></div>`,'compact');
  }
  function customerRequestModal(customerId){
    host.modal(`<div class="modal-head">${host.icons.inbox}<span>New customer request</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Summary',`<input id="wf-request-title" maxlength="180" placeholder="What is the customer asking for?">`)}${field('Details',`<textarea id="wf-request-description"></textarea>`)}${field('Issue',select('wf-request-issue',issueOptions()))}${field('Project',select('wf-request-project',projectOptions()))}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-customer-request" data-customer="${esc(customerId)}">Add request</button></div>`,'compact');
  }
  function pipelineModal(){host.modal(`<div class="modal-head">${host.icons.cycle}<span>New release pipeline</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Name',`<input id="wf-pipeline-name" maxlength="180" placeholder="Web production">`)}${field('Type',select('wf-pipeline-type',[['continuous','Continuous'],['scheduled','Scheduled']]))}${field('Environment',`<input id="wf-pipeline-environment" placeholder="Production">`)}${field('GitHub branch',`<input id="wf-pipeline-branch" placeholder="main" value="main">`)}${field('Team',select('wf-pipeline-team',teamOptions(),state().ui.teamId))}<p class="enterprise-muted">Continuous pipelines create a release when the connected GitHub repository receives a push on this branch.</p></div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-pipeline">Create pipeline</button></div>`,'compact')}
  function releaseModal(pipelineId){host.modal(`<div class="modal-head">${host.icons.cycle}<span>New release</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Name',`<input id="wf-release-name" maxlength="180" placeholder="v1.2.0">`)}${field('Date',`<input id="wf-release-date" type="date">`)}${field('Commit SHA',`<input id="wf-release-commit" placeholder="Optional">`)}${field('Issue IDs',`<input id="wf-release-issues" placeholder="ENG-123, ENG-124">`)}${field('Notes',`<textarea id="wf-release-notes"></textarea>`)}</div><div class="modal-footer"><span class="spacer"></span><button class="primary-button" data-action="wf-save-release" data-pipeline="${esc(pipelineId)}">Create release</button></div>`,'compact')}
  function releaseDetail(id){const r=list('releases').find(item=>item.id===id);if(!r)return;host.modal(`<div class="modal-head">${host.icons.cycle}<span>${esc(r.name)}</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body"><p>${esc(r.status)} · ${r.date?date(r.date):'No date'}</p><p>${htmlText(r.notes)}</p><div class="activity-title">Issues in this release</div>${(r.issueIds||[]).map(issueId=>`<button class="wf-linked-row" data-action="wf-open-issue" data-id="${esc(issueId)}">${esc(issueId)} · ${esc(host.issueBy(issueId)?.title||'Issue')}</button>`).join('')||'<p class="enterprise-muted">No linked issues.</p>'}</div><div class="modal-footer"><span class="spacer"></span>${button('Mark completed','wf-complete-release',`data-id="${esc(id)}"`)}</div>`,'compact')}
  function templateModal(id=''){
    const t=list('issueTemplates').find(item=>item.id===id)||{};
    host.modal(`<div class="modal-head">${host.icons.issue}<span>${id?'Edit':'New'} issue template</span><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${field('Template name',`<input id="wf-template-name" maxlength="180" value="${esc(t.name||'')}">`)}${field('Default title',`<input id="wf-template-title" maxlength="180" value="${esc(t.title||'')}">`)}${field('Description',`<textarea id="wf-template-description">${esc(t.description||'')}</textarea>`)}<div class="wf-form-grid">${field('Status',select('wf-template-status',statusesFor(state().ui.teamId).map(x=>[x.name,x.name]),t.status||defaultStatus(state().ui.teamId)))}${field('Priority',select('wf-template-priority',['No priority','Urgent','High','Medium','Low'].map(x=>[x,x]),t.priority||'No priority'))}</div>${field('Labels',`<input id="wf-template-labels" value="${esc((t.labels||[]).join(', '))}">`)}</div><div class="modal-footer">${id?button('Delete','wf-delete-template',`data-id="${esc(id)}"`):''}<span class="spacer"></span><button class="primary-button" data-action="wf-save-template" data-id="${esc(id)}">Save template</button></div>`,'compact');
  }

  async function perform(action,element){
    const id=element.dataset.id;
    try{
      if(action==='wf-new-status'||action==='wf-edit-status'){state().ui.statusEditor={id:id||'',category:element.dataset.category||statusesFor(state().ui.teamId).find(s=>s.id===id)?.category||'unstarted'};host.render();document.querySelector('#wf-status-name')?.focus();return}
      if(action==='wf-cancel-status'){state().ui.statusEditor=null;host.render();return}
      if(action==='wf-save-status'){
        const name=$('#wf-status-name').value.trim();if(!name)throw Error('Add a status name');
        await host.admin(id?'team.status.update':'team.status.create',{teamId:state().ui.teamId,id,name,description:$('#wf-status-description').value.trim(),category:$('#wf-status-category').value});
        state().ui.statusEditor=null;host.render();return;
      }
      if(action==='wf-default-status'){await host.admin('team.status.default',{teamId:state().ui.teamId,id});return}
      if(action==='wf-move-status'){await host.admin('team.status.move',{teamId:state().ui.teamId,id,direction:element.dataset.direction});return}
      if(action==='wf-delete-status'){deleteStatusModal(id);return}
      if(action==='wf-confirm-delete-status'){
        await host.admin('team.status.delete',{teamId:state().ui.teamId,id,replacementId:$('#wf-replacement-status').value});
        host.closeOverlay();host.render();return;
      }
      if(action==='wf-open-issue'){host.openIssue(id);return}
      if(action==='wf-select-issue'){
        const selected=state().ui.selectedIssueIds;
        state().ui.selectedIssueIds=selected.includes(id)?selected.filter(value=>value!==id):[...selected,id];
        host.render();return;
      }
      if(action==='wf-bulk-clear'){state().ui.selectedIssueIds=[];host.render();return}
      if(action==='wf-bulk-status'){bulkModal('status');return}
      if(action==='wf-bulk-priority'){bulkModal('priority');return}
      if(action==='wf-bulk-save'){
        const ids=[...state().ui.selectedIssueIds],value=$('#wf-bulk-value').value;
        for(const issueId of ids)await host.mutate('issue','update',issueId,{patch:{[element.dataset.field]:value}});
        state().ui.selectedIssueIds=[];host.closeOverlay();host.render();host.toast(`${ids.length} issues updated`);return;
      }
      if(action==='wf-new-subissue'){
        const title=prompt('Subissue title');if(!title?.trim())return;
        const parent=host.issueBy(id);const result=await host.mutate('issue','create','',{teamId:parent.teamId,value:{title:title.trim(),description:'',status:defaultStatus(parent.teamId),priority:'No priority',assignee:'',project:parent.project||'',projectId:parent.projectId||null,cycle:parent.cycle||'',labels:[],parentId:id}});host.openIssue(result.record.id);return;
      }
      if(action==='wf-edit-issue'){issueDetailsModal(id);return}
      if(action==='wf-save-issue'){
        const estimate=$('#wf-issue-estimate').value;await host.mutate('issue','update',id,{patch:{dueDate:$('#wf-issue-due').value,startDate:$('#wf-issue-start').value,estimate:estimate===''?null:Number(estimate),parentId:$('#wf-issue-parent').value,milestoneId:$('#wf-issue-milestone')?.value||''}});host.openIssue(id);return;
      }
      if(action==='wf-link-issue'){linkIssueModal(id);return}
      if(action==='wf-save-link'){
        const key=$('#wf-link-type').value,target=$('#wf-link-target').value,issue=host.issueBy(id);if(!target)throw Error('Choose an issue');await host.mutate('issue','update',id,{patch:{[key]:[...new Set([...(issue[key]||[]),target])]}});host.openIssue(id);return;
      }
      if(action==='wf-new-milestone'||action==='wf-edit-milestone'){milestoneModal(id,element.dataset.milestone);return}
      if(action==='wf-save-milestone'){
        const p=host.projectBy(id),name=$('#wf-milestone-name').value.trim();if(!name)throw Error('Add a milestone name');const milestone={id:element.dataset.milestone||crypto.randomUUID(),name,description:$('#wf-milestone-description').value.trim(),targetDate:$('#wf-milestone-date').value};await host.mutate('project','update',id,{patch:{milestones:[...(p.milestones||[]).filter(m=>m.id!==milestone.id),milestone]}});host.closeOverlay();host.render();return;
      }
      if(action==='wf-new-update'){updateModal(id);return}
      if(action==='wf-save-update'){
        const text=$('#wf-update-text').value.trim();if(!text)throw Error('Write an update');const p=host.projectBy(id);await host.mutate('project','update',id,{patch:{updates:[...(p.updates||[]),{id:crypto.randomUUID(),text,health:$('#wf-update-health').value,by:state().currentUserName,createdAt:new Date().toISOString()}]}});host.closeOverlay();host.render();return;
      }
      if(action==='wf-new-dependency'){dependencyModal(id);return}
      if(action==='wf-save-dependency'){
        const target=$('#wf-dependency-project').value;if(!target)throw Error('Choose a project');const p=host.projectBy(id);await host.mutate('project','update',id,{patch:{blockedByProjectIds:[...new Set([...(p.blockedByProjectIds||[]),target])]}});host.closeOverlay();host.render();return;
      }
      if(action==='wf-new-document'){documentModal('',element.dataset.project||'');return}
      if(action==='wf-open-document'||action==='wf-edit-document'){documentModal(id);return}
      if(action==='wf-save-document'){
        const name=$('#wf-doc-name').value.trim();if(!name)throw Error('Add a document title');const projectId=$('#wf-doc-project').value,project=host.projectBy(projectId);const teamId=project?.teamId||state().ui.teamId;const value={name,content:$('#wf-doc-content').value,projectId:projectId||''};await host.mutate('document',id?'update':'create',id,id?{patch:value}:{teamId,value});host.closeOverlay();host.render();return;
      }
      if(action==='wf-delete-document'){if(!confirm('Delete this document?'))return;await host.mutate('document','delete',id);host.closeOverlay();return}
      if(action==='wf-new-customer'||action==='wf-edit-customer'){customerModal(id);return}
      if(action==='wf-open-customer'){customerDetail(id);return}
      if(action==='wf-save-customer'){
        const name=$('#wf-customer-name').value.trim();if(!name)throw Error('Add a customer name');const revenue=$('#wf-customer-revenue').value;const value={name,domain:$('#wf-customer-domain').value.trim(),tier:$('#wf-customer-tier').value,status:$('#wf-customer-status').value,revenue:revenue?Number(revenue):0,notes:$('#wf-customer-notes').value.trim()};await host.mutate('customer',id?'update':'create',id,id?{patch:value}:{value});host.closeOverlay();host.render();return;
      }
      if(action==='wf-new-customer-request'){customerRequestModal(element.dataset.customer);return}
      if(action==='wf-save-customer-request'){
        const title=$('#wf-request-title').value.trim(),issueId=$('#wf-request-issue').value,projectId=$('#wf-request-project').value;if(!title)throw Error('Add a request summary');if(!issueId&&!projectId)throw Error('Choose an issue or project');const teamId=host.issueBy(issueId)?.teamId||host.projectBy(projectId)?.teamId||state().ui.teamId;const value={title,description:$('#wf-request-description').value.trim(),customerId:element.dataset.customer,issueId:issueId||'',projectId:projectId||'',source:'manual',requester:state().currentUserName,createdAt:new Date().toISOString()};await host.mutate('customerRequest','create','',{teamId,value});customerDetail(element.dataset.customer);return;
      }
      if(action==='wf-new-pipeline'){pipelineModal();return}
      if(action==='wf-save-pipeline'){
        const name=$('#wf-pipeline-name').value.trim();if(!name)throw Error('Add a pipeline name');const teamId=$('#wf-pipeline-team').value;await host.mutate('releasePipeline','create','',{teamId,value:{name,description:'',type:$('#wf-pipeline-type').value,environment:$('#wf-pipeline-environment').value.trim(),branch:$('#wf-pipeline-branch').value.trim()||'main',teamIds:[teamId]}});host.closeOverlay();return;
      }
      if(action==='wf-new-release'){releaseModal(element.dataset.pipeline);return}
      if(action==='wf-save-release'){
        const pipeline=list('releasePipelines').find(p=>p.id===element.dataset.pipeline);if(!pipeline)throw Error('Pipeline not found');const name=$('#wf-release-name').value.trim();if(!name)throw Error('Add a release name');const issueIds=$('#wf-release-issues').value.split(',').map(x=>x.trim()).filter(Boolean);await host.mutate('release','create','',{teamId:pipeline.teamId,value:{name,pipelineId:pipeline.id,status:'planned',date:$('#wf-release-date').value,commitSha:$('#wf-release-commit').value.trim(),issueIds,notes:$('#wf-release-notes').value.trim()}});host.closeOverlay();return;
      }
      if(action==='wf-open-release'){releaseDetail(id);return}
      if(action==='wf-complete-release'){await host.mutate('release','update',id,{patch:{status:'completed'}});releaseDetail(id);return}
      if(action==='wf-new-template'||action==='wf-edit-template'){templateModal(id);return}
      if(action==='wf-save-template'){
        const name=$('#wf-template-name').value.trim();if(!name)throw Error('Add a template name');const value={name,title:$('#wf-template-title').value.trim(),description:$('#wf-template-description').value.trim(),status:$('#wf-template-status').value,priority:$('#wf-template-priority').value,labels:$('#wf-template-labels').value.split(',').map(x=>x.trim()).filter(Boolean)};await host.mutate('issueTemplate',id?'update':'create',id,id?{patch:value}:{teamId:state().ui.teamId,value});host.closeOverlay();return;
      }
      if(action==='wf-delete-template'){if(!confirm('Delete this template?'))return;await host.mutate('issueTemplate','delete',id);host.closeOverlay();return}
      if(action==='wf-open-project'){state().ui.projectId=id;host.go('project');return}
      if(action==='wf-open-initiative'){state().ui.initiativeId=id;host.go('initiative');return}
      if(action==='wf-add-filter'){$('#wf-view-filters').insertAdjacentHTML('beforeend',renderFilterRow());return}
      if(action==='wf-remove-filter'){element.closest('.wf-filter-row')?.remove();return}
      if(action==='wf-edit-view'){newView(list('views').find(v=>v.id===id));return}
      if(action==='wf-save-view'){
        const name=$('#wf-view-name').value.trim();if(!name)throw Error('Add a view name');const entity=$('#wf-view-entity').value,scope=$('#wf-view-scope').value;const filters=[...document.querySelectorAll('.wf-filter-row')].map(row=>({field:row.querySelector('select:first-child').value,op:row.querySelector('select:nth-child(2)').value,value:row.querySelector('input').value.trim()})).filter(f=>f.value);const value={name,description:$('#wf-view-description').value.trim(),type:'custom',entity,scope,filters};const result=await host.mutate('view',id?'update':'create',id,id?{patch:value}:{teamId:state().ui.teamId,personal:scope==='personal',workspace:scope==='workspace',value});host.closeOverlay();state().ui.viewId=result.record.id;host.go('custom');return;
      }
    }catch(error){host.toast(error.message||'Action failed')}
  }
  document.addEventListener('click',event=>{
    const element=event.target.closest('[data-action^="wf-"]');if(!element)return;
    perform(element.dataset.action,element);
  });
  document.addEventListener('change',event=>{
    if(event.target.id!=='wf-template-choice')return;
    const template=list('issueTemplates').find(t=>t.id===event.target.value);
    if(!template)return;
    const draft=state().draft;
    Object.assign(draft,{templateId:template.id,title:template.title||'',description:template.description||'',status:template.status,priority:template.priority,labels:[...(template.labels||[])]});
    host.drawNewIssue();
  });
  window.LinearWorkflows={issueCreateFields,readIssueDraft,issuePanel,projectFormFields,readProjectForm,projectPanel,initiativeFormFields,readInitiativeForm,initiativePanel,renderPage,renderView,filterViewIssues,viewCount,newView,searchResults,bulkToolbar};
  window.dispatchEvent(new Event('linear-workflows-ready'));
  }
  if(window.LinearHost)init();else window.addEventListener('linear-host-ready',init,{once:true});
})();
