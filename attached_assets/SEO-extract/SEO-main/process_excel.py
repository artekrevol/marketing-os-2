import pandas as pd
import json
import sys
from datetime import datetime

# Read the Excel file
try:
    df = pd.read_excel('attached_assets/Ranking Data for automation tool.xlsx')
    print("Successfully read Excel file. Data preview:")
    print(df.head())
    print(f"Columns in the file: {df.columns.tolist()}")
    
    # Prepare data for import
    keywords_data = []
    
    for index, row in df.iterrows():
        try:
            keyword = str(row.get('Keywords', ''))
            location = str(row.get('Location', ''))
            position = row.get('Ranking ', None)  # Note the space after "Ranking"
            
            # Set defaults
            target_url = "https://www.tekrevol.com"
            group = "Imported"
            
            if not keyword or keyword == 'nan':
                continue
                
            # Clean data
            if pd.isna(position):
                position = None
            else:
                try:
                    position = int(position)
                except:
                    position = None
                    
            if pd.isna(location) or location == 'nan':
                location = "Houston"  # Default to Houston if location is missing
                
            keywords_data.append({
                "keyword": keyword,
                "location": location,
                "position": position,
                "targetUrl": target_url,
                "group": group
            })
            
        except Exception as e:
            print(f"Error processing row {index}: {e}")
    
    # Save to JSON for API consumption
    with open('keywords_import.json', 'w') as f:
        json.dump(keywords_data, f, indent=2)
    
    print(f"\nProcessed {len(keywords_data)} keywords and saved to keywords_import.json")
    
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)