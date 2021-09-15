// Copyright (c) 2019 SafetyCulture Pty Ltd. All Rights Reserved.
/* global chrome */

const kMessageSource = "__GRPCWEB_DEVTOOLS__";

let port;

function injectors(msgSource) {

  const MethodType = {
    UNARY: 'unary',
    SERVER_STREAMING: 'server_streaming'
  };

  const postMessage = (type, name, reqMsg, resMsg, error) => {
    const request = reqMsg;
    const response = error ? undefined : resMsg;
    error = error ? (({code, message}) => ({ code, message }))(error) : error;
    const msg = {
      source: msgSource,
      methodType: type,
      method: name,
      request,
      response,
      error,
      
    };
    window.postMessage(JSON.parse(JSON.stringify(msg)), '*');
  }

  class DevToolsUnaryInterceptor {
    type = MethodType.UNARY;

    postResponse = (name, req, res) => {
      postMessage(this.type, name, req, res);
      return res;
    }

    postError = (name, req, error) => {
      if (error.code === 0) return error;
      postMessage(this.type, name, req, undefined, error);
      return error;
    }

    intercept = async (request, invoker, grpcGatewayUrl, serviceName, functionName) => {
      const name = `${grpcGatewayUrl}/${serviceName}/${functionName}`; 

      try {
        const response = await invoker(request);
        this.postResponse(name, request, response)
        return response
      } catch (error){
        throw this.postError(name, request, error);
      }
    }
  }

  class DevToolsStreamInterceptor {
 
    intercept(request, invoker, grpcGatewayUrl, serviceName, functionName) {
      function postStreamRequest(req, name, type) {
        postMessage(type, name, req);
        return req;
      }
  
      function postStreamData(data, name, type){
        postMessage(type, name, undefined, data);
        return data;
      }
  
      function postStreamError (error, name, type) {
        if (error.code === 0) return error;
        postMessage(type, name, undefined, undefined, error);
        return error;
      }

      function  postStreamStatus(name, type) {
        const status  = "EOF"
        return postStreamData(status, name, type);
      } 

      const arr = [];
      const type = MethodType.SERVER_STREAMING;
      const name = `${grpcGatewayUrl}/${serviceName}/${functionName}`;  
      
      postStreamRequest(request, name, type)
      const stream = invoker(request);
        
      stream.subscribe({
        next(x) { 
          postStreamData(x, name, type);
          arr.push(arr)
        },
        error(err) { postStreamError(err, name, type) },
        complete() { postStreamStatus(name, type) }     
      }); 
      return stream
    }
  }

  return {
    devToolsUnaryInterceptor: new DevToolsUnaryInterceptor(),
    devToolsStreamInterceptor: new DevToolsStreamInterceptor(),
  };
}

const injectContent = `window.__GRPCWEB_DEVTOOLS__ = () => ${injectors}("${kMessageSource}");`

let s = document.createElement('script');
s.type = 'text/javascript';
const scriptNode = document.createTextNode(injectContent);
s.appendChild(scriptNode);
(document.head || document.documentElement).appendChild(s);
s.parentNode.removeChild(s);

function setupPortIfNeeded() {
  if (!port && chrome?.runtime) {
    port = chrome.runtime.connect(null, {name: "content"});
    port.postMessage({action: "init"});
    port.onDisconnect.addListener(handleDisconnect);
  }
}

function sendGRPCNetworkCall(data) {
  setupPortIfNeeded();
  if (port) {
    port.postMessage({
      action: "gRPCNetworkCall",
      target: "panel",
      data,
    });
  }
}

function handleMessageEvent(event) {
  if (
    event.source === window &&
    event?.data.source === kMessageSource
  ) {
    sendGRPCNetworkCall(event.data);
  }
}

function handleDisconnect() {
  port = null;
  window.removeEventListener("message", handleMessageEvent, false);
}

window.addEventListener("message", handleMessageEvent, false);
