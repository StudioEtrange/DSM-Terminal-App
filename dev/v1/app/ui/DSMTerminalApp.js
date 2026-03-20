Ext.ns("SYNO.SDS.App.DSMTerminal");

SYNO.SDS.App.DSMTerminal = Ext.extend(SYNO.SDS.AppWindow, {
    constructor: function () {
        this.windowId = Ext.id(null, "dsm-terminal-window-");
        this.panelId = Ext.id(null, "dsm-terminal-panel-");
        this.iframeId = Ext.id(null, "dsm-terminal-frame-");

        SYNO.SDS.App.DSMTerminal.superclass.constructor.call(this, {
            id: this.windowId,
            width: 520,
            height: 360,
            minWidth: 420,
            minHeight: 260,
            maximizable: true,
            resizable: true,
            layout: "fit",
            title: "DSM Terminal",
            cls: "dsm-terminal-window",
            items: [
                {
                    xtype: "panel",
                    id: this.panelId,
                    border: false,
                    layout: "fit",
                    html: '<iframe id="' + this.iframeId + '" data-window-id="' + this.windowId + '" src="/webman/3rdparty/dsm-terminal/index.html" style="display:block;width:100%;height:100%;border:0;background:#ffffff;"></iframe>'
                }
            ],
            listeners: {
                show: this.bindFrameActivation,
                scope: this
            }
        });
    },

    bindFrameActivation: function () {
        var frame = Ext.get(this.iframeId);
        if (!frame) {
            return;
        }

        frame.removeAllListeners();
        frame.on("load", this.attachFrameListeners, this);
        this.attachFrameListeners();
    },

    attachFrameListeners: function () {
        var frame = document.getElementById(this.iframeId);
        var doc;
        var win;
        var activate = this.activateFromFrame.createDelegate(this);

        if (!frame) {
            return;
        }

        frame.onclick = activate;
        frame.onmousedown = activate;

        try {
            win = frame.contentWindow;
            doc = win && win.document;
            if (!doc) {
                return;
            }

            doc.onclick = activate;
            doc.onmousedown = activate;
            if (doc.body) {
                doc.body.onclick = activate;
                doc.body.onmousedown = activate;
            }
        } catch (e) {
        }
    },

    activateFromFrame: function () {
        this.toFront();
        this.setActive();
    }
});

SYNO.SDS.App.DSMTerminal.Instance = Ext.extend(SYNO.SDS.AppInstance, {
    appWindowName: "SYNO.SDS.App.DSMTerminal"
});
