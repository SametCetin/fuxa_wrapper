'use strict';

// Only the served bundle is adapted. These anchors belong to engine 1.3.4;
// refuse an unfamiliar build rather than silently present the wrong ADS form.
function patchEditor(source) {
    const replace = (before, after) => {
        if (source.split(before).length !== 2) throw new Error('ADS bağlantı arayüzü değişmiş; uyarlama doğrulanmalı.');
        source = source.replace(before, after);
    };
    replace('_e.ADSclient="ADSclient",', '_e.ADSclient="ADSclient",_e.FuxawADS="FuxawADS",');
    replace('t.type===an.bq.ADSclient?', '(t.type===an.bq.ADSclient||t.type===an.bq.FuxawADS)?');
    replace('t===an.bq.ADSclient||', 't===an.bq.ADSclient||t===an.bq.FuxawADS||');
    replace('this.deviceSelected.type!==an.bq.ADSclient?', '(this.deviceSelected.type!==an.bq.ADSclient&&this.deviceSelected.type!==an.bq.FuxawADS)?');
    replace('e.SpI(" ",t.value," ")}}function p_e',
        'e.SpI(" ",t.key==="FuxawADS"?"ADS (fuxaw)":t.key==="ADSclient"?"ADSclient (orijinal)":t.value," ")}}function p_e');
    replace('e.JRh(e.bMT(15,15,"plugin.group-"+t.group))',
        'e.JRh(t.bundled?t.description:e.bMT(15,15,"plugin.group-"+t.group))');
    // Keep the existing TCP behavior of saved projects lacking adsTransport.
    // The user selects the local TwinCAT router explicitly in the same form.
    replace('onDeviceTypeChanged(){this.pollingType=',
        'onDeviceTypeChanged(){if(this.data.device.type==="FuxawADS"){const p=this.data.device.property||(this.data.device.property={});p.adsTransport||(p.adsTransport="tcp"),this.data.device.polling??=1000}this.pollingType=');
    replace('t.property.local=o.property.local,t.property.router=o.property.router',
        't.property.local=o.property.local,t.property.router=o.property.router,t.type==="FuxawADS"?(t.property.adsTransport=o.property.adsTransport||"tcp"):t.type==="ADSclient"&&delete t.property.adsTransport');
    const start = source.indexOf('function l1e(r,a){');
    const end = source.indexOf('function c1e(r,a){', start);
    if (start < 0 || end < 0) throw new Error('ADS bağlantı alanları bulunamadı.');
    let template = source.slice(start, end);
    const replaceTemplate = (before, after) => {
        if (template.split(before).length !== 2) throw new Error('ADS bağlantı alanları değişmiş.');
        template = template.replace(before, after);
    };
    replaceTemplate('e.k0s()()()}if(2&r)', 'e.k0s()(),e.j41(16,"div",60)(17,"span"),e.EFF(18,"Bağlantı yöntemi · fuxaw ADS"),e.k0s(),e.j41(19,"mat-select",25),e.bIt("valueChange",function(i){e.eBV(t);const o=e.XpG(3);return o.data.device.property.adsTransport=i,e.Njj(i)}),e.j41(20,"mat-option",27),e.EFF(21,"Yerel TwinCAT (Windows)"),e.k0s(),e.j41(22,"mat-option",27),e.EFF(23,"ADS-TCP"),e.k0s()()(),e.j41(24,"p"),e.EFF(25,"Hedef: AMS Net ID:port (ör. 1.2.3.4.5.6:851). Yerel yöntemde TwinCAT rotaları kullanılır."),e.k0s()()}if(2&r)');
    replaceTemplate('e.R50("ngModel",t.data.device.property.address),e.R7$(3)',
        'e.R50("ngModel",t.data.device.property.address),e.R7$(),e.xc7("display",t.data.device.property.adsTransport==="native"?"none":null),e.R7$(2)');
    replaceTemplate('e.R50("ngModel",t.data.device.property.local),e.R7$(3)',
        'e.R50("ngModel",t.data.device.property.local),e.R7$(),e.xc7("display",t.data.device.property.adsTransport==="native"?"none":null),e.R7$(2)');
    replaceTemplate('e.R50("ngModel",t.data.device.property.router)}}',
        'e.R50("ngModel",t.data.device.property.router),e.R7$(4),e.R50("value",t.data.device.property.adsTransport),e.xc7("width",350,"px"),e.R7$(),e.Y8G("value","native")("disabled",' +
        JSON.stringify(process.platform !== 'win32' || process.arch !== 'x64') + '),e.R7$(2),e.Y8G("value","tcp")}}');
    template = template.replace('e.bMT(4,6,', 'e.bMT(4,16,')
        .replace('e.bMT(9,8,', 'e.bMT(9,18,').replace('e.bMT(14,10,', 'e.bMT(14,20,');
    // Preserve the original ADS form; add a separate form case for our plugin.
    replace(source.slice(start, end), source.slice(start, end) + template.replace('function l1e(', 'function fxwAdsForm('));
    replace('(14,v1e,14,12,"div",39),e.k0s())', '(14,v1e,14,12,"div",39)(15,fxwAdsForm,26,22,"div",39),e.k0s())');
    replace('e.Y8G("ngSwitchCase",t.deviceType.REDIS)}}function y1e', 'e.Y8G("ngSwitchCase",t.deviceType.REDIS),e.R7$(),e.Y8G("ngSwitchCase",t.deviceType.FuxawADS)}}function y1e');
    replace('_1e,15,15,', '_1e,16,16,');
    return source;
}

module.exports = { patchEditor };
