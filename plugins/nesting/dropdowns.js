(function(){
  'use strict';
  const controls=[];let opened=null,active=0,search='',searchAt=0;
  const menu=document.createElement('div');menu.id='pluginSelectMenu';menu.className='selectMenu';menu.setAttribute('role','listbox');menu.hidden=true;document.body.append(menu);
  function close(restore=false){const old=opened;opened=null;menu.hidden=true;if(old){old.button.setAttribute('aria-expanded','false');old.button.removeAttribute('aria-activedescendant');if(restore)old.button.focus({preventScroll:true});}}
  function sync(c){c.button.textContent=c.select.selectedOptions[0]?.textContent||'No options';c.button.disabled=c.select.disabled||!c.select.options.length;c.button.title=c.button.textContent;if(opened===c&&c.button.disabled)close();}
  function refresh(){controls.forEach(sync);}
  function highlight(index){
    const rows=[...menu.children];if(!rows.length)return;active=Math.max(0,Math.min(rows.length-1,index));
    rows.forEach((row,i)=>row.classList.toggle('active',i===active));
    opened.button.setAttribute('aria-activedescendant',rows[active].id);
    // Scroll ONLY the menu. scrollIntoView can scroll the containing Dashboard.
    const row=rows[active];if(row.offsetTop<menu.scrollTop)menu.scrollTop=row.offsetTop;else if(row.offsetTop+row.offsetHeight>menu.scrollTop+menu.clientHeight)menu.scrollTop=row.offsetTop+row.offsetHeight-menu.clientHeight;
  }
  function choose(index){
    const c=opened,option=c?.select.options[index];if(!c||!option||option.disabled)return;
    close(true);c.select.selectedIndex=index;c.select.dispatchEvent(new Event('input',{bubbles:true}));c.select.dispatchEvent(new Event('change',{bubbles:true}));refresh();
  }
  function open(c){
    if(c.button.disabled)return;if(opened===c){close();return;}close();opened=c;search='';menu.replaceChildren();
    [...c.select.options].forEach((option,i)=>{const row=document.createElement('div');row.id='pluginOption-'+i;row.className='selectOption';row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(option.disabled));row.textContent=option.textContent;row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>choose(i));menu.append(row);});
    menu.setAttribute('aria-label',c.button.getAttribute('aria-label'));c.button.setAttribute('aria-expanded','true');menu.hidden=false;
    const r=c.button.getBoundingClientRect(),margin=8,below=innerHeight-r.bottom-margin,above=r.top-margin;
    const downward=below>=Math.min(240,above),available=Math.max(40,downward?below:above);
    menu.style.width=Math.min(Math.max(r.width,180),innerWidth-2*margin)+'px';
    menu.style.maxHeight=Math.min(280,available)+'px';menu.style.left=Math.max(margin,Math.min(r.left,innerWidth-menu.offsetWidth-margin))+'px';
    menu.style.top=Math.max(margin,Math.min(downward?r.bottom+2:r.top-menu.offsetHeight-2,innerHeight-menu.offsetHeight-margin))+'px';
    menu.scrollTop=0;highlight(Math.max(0,c.select.selectedIndex));
  }
  for(const select of document.querySelectorAll('select')){
    const button=document.createElement('button');button.type='button';button.className='selectButton';button.id=select.id+'-button';button.setAttribute('role','combobox');button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',menu.id);
    const label=select.closest('label');button.setAttribute('aria-label',label?[...label.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent.trim()).join(' ').trim():select.id);
    select.classList.add('selectBacking');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.after(button);
    const c={select,button};controls.push(c);button.addEventListener('click',()=>open(c));select.addEventListener('change',refresh);
    new MutationObserver(()=>{sync(c);if(opened===c)close();}).observe(select,{childList:true,subtree:true,attributes:true,characterData:true});
    button.addEventListener('keydown',event=>{
      if(event.key==='Tab'){close();return;}
      if(event.key==='Escape'){if(opened){event.preventDefault();event.stopPropagation();close(true);}return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)){
        event.preventDefault();if(opened!==c){open(c);return;}
        if(event.key==='Enter'||event.key===' '){choose(active);return;}
        let next=event.key==='Home'?0:event.key==='End'?select.options.length-1:active+(event.key==='ArrowDown'?1:-1);
        const direction=next>=active?1:-1;while(select.options[next]?.disabled)next+=direction;highlight(next);return;
      }
      if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();if(opened!==c)open(c);const now=Date.now();search=(now-searchAt>700?'':search)+event.key.toLowerCase();searchAt=now;const index=[...select.options].findIndex(o=>!o.disabled&&o.textContent.toLowerCase().startsWith(search));if(index>=0)highlight(index);}
    });
  }
  document.addEventListener('pointerdown',event=>{if(opened&&!menu.contains(event.target)&&!opened.button.contains(event.target))close();});
  document.addEventListener('scroll',event=>{if(opened&&event.target!==menu&&!menu.contains(event.target))close();},true);
  window.addEventListener('resize',()=>close());window.Dropdowns={refresh,close};refresh();
})();
