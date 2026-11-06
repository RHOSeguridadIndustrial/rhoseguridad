"""Convierte el Excel RHO en JSON para importación privada en el panel.
Uso: python scripts/comparativo_excel.py archivo.xlsx salida.json
Requiere openpyxl. No suba el JSON de compras al repositorio público.
"""
import sys,json,datetime
from openpyxl import load_workbook
w=load_workbook(sys.argv[1],data_only=True)
def value(v):
 return v.isoformat() if isinstance(v,(datetime.date,datetime.datetime)) else v
suppliers=[c.value for c in w['Comparativo'][6][5:19]]
items=[]
for row in list(w['Catalogo RHO'].values)[6:]:
 if not isinstance(row[0],int):continue
 items.append(dict(id=row[0],name=row[1],unit=row[3]))
offers=[]
for r in list(w['Ofertas'].values)[6:]:
 if not isinstance(r[0],int):continue
 offers.append(dict(article=r[0],supplier=r[2],price=r[10] if isinstance(r[10],(int,float)) else None,stock=r[7],conditions=r[12],date=value(r[13]),url=r[14]))
json.dump(dict(version=1,items=items,suppliers=suppliers,offers=offers),open(sys.argv[2],'w'),ensure_ascii=False,indent=2)
